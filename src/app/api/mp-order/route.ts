import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verwerkGarantiebewijs } from "@/lib/garantiebewijs";
import { requireAccountEmail } from "@/lib/account";
import { extractModelnaamVanProduct } from "@/lib/shopify-order";
import { loadProductDefaultItemsRules } from "@/lib/product-rules-server";
import { defaultMeenemenInPlanning } from "@/lib/planning-date";
import { deductInventoryForMpOrder, buildInventoryDeductionLineItems } from "@/lib/inventory";
import { createServerSupabaseClient } from "@/lib/supabase";
import { isMpPausedForOwner } from "@/lib/mp-pause";
import {
  buildMpLineItemsJson,
  buildMpShopifyLineItems,
  collectMpUnmountedAccessoryDeductions,
  modelFromMpLijst,
  parsePrijs,
  productenTekstFromMpLijst,
  type MpProductRegel,
} from "@/lib/mp-order-products";
import type { ProductDefaultItemsRulesV2 } from "@/lib/product-default-items-rules";

/** Extraheer fietsmodel: 'V20 PRO Fatbike 2026 + ringslot | Combi-Deal 🔥' → 'V20 PRO' */
function extractModel(producten: string | null): string | null {
  if (!producten) return null;
  const match = producten.match(/^(.+?)\s+fatbike/i);
  if (match) return match[1].trim();
  return producten.split(/[|,]/)[0].trim() || null;
}

/** Voorraadaftrek: fiets + standaardproducten + family-deal + extras (ook “Apart in doos”). */
function buildMpDeductionLineItems(
  productenLijst: MpProductRegel[],
  rules: ProductDefaultItemsRulesV2
) {
  const lineItems = buildMpShopifyLineItems(productenLijst);
  if (!lineItems.length) return [];
  const fromLines = buildInventoryDeductionLineItems(lineItems, rules);
  const extras = collectMpUnmountedAccessoryDeductions(productenLijst);
  if (!extras.length) return fromLines;
  return [...fromLines, ...extras];
}

function normalizeAdres(body: {
  straatnaam?: string;
  huisnummer?: string;
  postcode?: string;
  woonplaats?: string;
}) {
  const straat = (body.straatnaam ?? "").trim();
  const huisnummer = (body.huisnummer ?? "").trim();
  const postcode = (body.postcode ?? "").trim();
  const woonplaats = (body.woonplaats ?? "").trim();
  const volledigAdres = [straat, huisnummer, postcode, woonplaats].filter(Boolean).join(", ");
  const mapsUrl = volledigAdres
    ? `https://maps.google.com/maps?q=${encodeURIComponent(volledigAdres)}`
    : null;
  return { volledigAdres, mapsUrl };
}

function normalizeTelefoon(telefoonRaw: string) {
  const e164 = telefoonRaw.startsWith("+")
    ? telefoonRaw
    : telefoonRaw.startsWith("0")
      ? "+31" + telefoonRaw.slice(1)
      : telefoonRaw;
  const belLink = e164 ? `https://call.ctrlq.org/${e164}` : null;
  return { e164, belLink };
}

const PLANNED_STATUSES = ["ritjes_vandaag", "gepland"] as const;

/**
 * GET /api/mp-order
 * Lijst geplande MP-orders (ritjes_vandaag / gepland).
 * Of ?id=… voor één order.
 */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const id = request.nextUrl.searchParams.get("id");

    if (id) {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_nummer, type, status, naam, email, telefoon_nummer, volledig_adres, bezorgtijd_voorkeur, datum_opmerking, opmerkingen_klant, producten, bestelling_totaal_prijs, aantal_fietsen, model, line_items_json, serienummer"
        )
        .eq("id", id)
        .eq("owner_email", ownerEmail)
        .eq("source", "mp")
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
      }
      return NextResponse.json({ order: data });
    }

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_nummer, type, status, naam, email, telefoon_nummer, volledig_adres, bezorgtijd_voorkeur, datum_opmerking, opmerkingen_klant, producten, bestelling_totaal_prijs, aantal_fietsen, model, line_items_json, serienummer"
      )
      .eq("owner_email", ownerEmail)
      .eq("source", "mp")
      .in("status", [...PLANNED_STATUSES])
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ orders: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/mp-order
 * Werk een geplande MP-order bij (zelfde rij → ritjes vandaag / planning sync).
 */
export async function PATCH(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const body = await request.json().catch(() => ({}));
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is verplicht." }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("orders")
      .select("id, order_nummer, source, status, type, naam, telefoon_nummer, telefoon_e164")
      .eq("id", id)
      .eq("owner_email", ownerEmail)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existing || existing.source !== "mp") {
      return NextResponse.json({ error: "MP-order niet gevonden." }, { status: 404 });
    }
    if (!PLANNED_STATUSES.includes(existing.status as (typeof PLANNED_STATUSES)[number])) {
      return NextResponse.json(
        { error: "Alleen orders in ritjes vandaag of planning kunnen worden bewerkt." },
        { status: 400 }
      );
    }

    const naam = (body.naam ?? "").trim();
    if (!naam) {
      return NextResponse.json({ error: "Naam klant is verplicht." }, { status: 400 });
    }

    const productenLijst: MpProductRegel[] = Array.isArray(body.producten_lijst)
      ? body.producten_lijst
      : [];
    if (!productenLijst.length || productenLijst.some((p) => !String(p.naam ?? "").trim())) {
      return NextResponse.json({ error: "Vul alle productnamen in." }, { status: 400 });
    }

    const { volledigAdres, mapsUrl } = normalizeAdres(body);
    const telefoonRaw = (body.telefoonnummer ?? body.telefoon_nummer ?? "").trim();
    const { e164, belLink } = normalizeTelefoon(telefoonRaw);

    const totaalPrijs = productenLijst.reduce((sum, p) => sum + parsePrijs(p.prijs), 0);
    const producten = productenTekstFromMpLijst(productenLijst);
    const aantalFietsen = productenLijst.filter((p) => p.type === "fiets").length;
    const model = modelFromMpLijst(productenLijst);

    const productRules = await loadProductDefaultItemsRules(supabase, ownerEmail);
    const lineItemsJson = buildMpLineItemsJson(productenLijst, productRules);

    const mpDatumOpmerking =
      (body.datum_voorkeur ?? "").trim().toLowerCase() === "x"
        ? "vandaag"
        : (body.datum_voorkeur ?? "").trim() || null;

    const update = {
      naam,
      volledig_adres: volledigAdres || null,
      adres_url: mapsUrl,
      telefoon_nummer: telefoonRaw || null,
      telefoon_e164: e164 || null,
      bel_link: belLink,
      email: (body.email ?? "").trim() || null,
      producten,
      bestelling_totaal_prijs: totaalPrijs || null,
      aantal_fietsen: aantalFietsen || null,
      model: model ?? null,
      line_items_json: lineItemsJson,
      bezorgtijd_voorkeur:
        (body.bezorgtijd_voorkeur ?? "").trim().toLowerCase() === "x"
          ? "geen"
          : (body.bezorgtijd_voorkeur ?? "").trim() || null,
      datum_opmerking: mpDatumOpmerking,
      opmerkingen_klant:
        (body.opmerking ?? "").trim().toLowerCase() === "x"
          ? "geen opmerking"
          : (body.opmerking ?? "").trim() || null,
    };

    const { data, error } = await supabase
      .from("orders")
      .update(update)
      .eq("id", id)
      .eq("owner_email", ownerEmail)
      .select("id, order_nummer")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Opslaan mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    try {
      const deductionLineItems = buildMpDeductionLineItems(productenLijst, productRules);
      const { reserveInventoryForMpOrder, clearReservationsForOrder } =
        await import("@/lib/inventory-reservations");
      if (deductionLineItems.length) {
        await reserveInventoryForMpOrder(
          supabase,
          ownerEmail,
          data.id,
          data.order_nummer ?? "",
          deductionLineItems,
          {
            customerName: naam,
            customerPhone: e164 || telefoonRaw || null,
          }
        );
      } else {
        // Geen aftrekbare producten meer → reservering volledig vrijgeven.
        await clearReservationsForOrder(
          supabase,
          ownerEmail,
          "marktplaats",
          data.id,
          { skipAlerts: true }
        );
      }
    } catch (invErr) {
      console.error("[api/mp-order] PATCH inventory sync:", invErr);
    }

    return NextResponse.json({
      ok: true,
      id: data.id,
      order_nummer: data.order_nummer,
      message: "Order bijgewerkt in ritjes vandaag / planning.",
    });
  } catch (e) {
    console.error("[api/mp-order] PATCH", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mp-order
 * Slaat een nieuwe Marktplaats order op in Supabase.
 * - Bezorging → status 'ritjes_vandaag', type 'verkoop'
 * - Afhaal → status 'mp_orders', type 'mp_winkel';
 *   maakt direct een garantiebewijs via Google Docs en stuurt het via Gmail.
 */
export async function POST(request: NextRequest) {
  console.log("[api/mp-order] POST ontvangen", new Date().toISOString());
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      console.error("[api/mp-order] Supabase env vars ontbreken");
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const ownerEmail = requireAccountEmail(request);

    if (await isMpPausedForOwner(createServerSupabaseClient(), ownerEmail)) {
      return NextResponse.json(
        { error: "Marktplaats-orders zijn momenteel uitgeschakeld." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    console.log("[api/mp-order] soort:", body.soort, "naam:", body.naam);
    const soort = body.soort as "bezorging" | "afhaal";

    const { volledigAdres, mapsUrl } = normalizeAdres(body);
    const telefoonRaw = (body.telefoonnummer ?? "").trim();
    const { e164, belLink } = normalizeTelefoon(telefoonRaw);
    const naam = (body.naam ?? "").trim();

    // Datum (Amsterdam timezone)
    const nu = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
    const dd = String(nu.getDate()).padStart(2, "0");
    const mm = String(nu.getMonth() + 1).padStart(2, "0");
    const yyyy = nu.getFullYear();
    const datumDb = `${yyyy}-${mm}-${dd}`;

    // Genereer ordernummer
    const supabaseTemp = createClient(supabaseUrl, serviceKey);
    let orderNummer: string | null = null;
    if (soort === "afhaal") {
      const { data: laatste } = await supabaseTemp
        .from("orders").select("order_nummer")
        .eq("owner_email", ownerEmail)
        .like("order_nummer", "#MPA%")
        .order("order_nummer", { ascending: false }).limit(1).maybeSingle();
      const prev = laatste?.order_nummer ? parseInt(laatste.order_nummer.replace("#MPA", ""), 10) : 999;
      orderNummer = `#MPA${isNaN(prev) ? 1000 : prev + 1}`;
    } else {
      const { data: laatste } = await supabaseTemp
        .from("orders").select("order_nummer")
        .eq("owner_email", ownerEmail)
        .like("order_nummer", "#MPB%")
        .order("order_nummer", { ascending: false }).limit(1).maybeSingle();
      const prev = laatste?.order_nummer ? parseInt(laatste.order_nummer.replace("#MPB", ""), 10) : 1024;
      orderNummer = `#MPB${isNaN(prev) ? 1025 : prev + 1}`;
    }

    const productenLijst: MpProductRegel[] = Array.isArray(body.producten_lijst)
      ? body.producten_lijst
      : [];

    const totaalPrijsUitProducten = productenLijst.length
      ? productenLijst.reduce((sum, p) => sum + parsePrijs(p.prijs), 0)
      : null;
    const totaalPrijs = totaalPrijsUitProducten
      ?? (body.totaal_prijs ? parseFloat(String(body.totaal_prijs)) : null);

    const productenTekst = productenLijst.length
      ? productenTekstFromMpLijst(productenLijst)
      : ((body.producten ?? "").trim() || null);

    const producten = productenTekst;

    const aantalFietsenBerekend = productenLijst.length
      ? productenLijst.filter((p) => p.type === "fiets").length
      : (body.aantal_fietsen ? parseInt(String(body.aantal_fietsen), 10) : null);

    const eersteFiets = productenLijst.find((p) => p.type === "fiets");
    const modelBerekend = eersteFiets
      ? extractModelnaamVanProduct(eersteFiets.naam)
      : extractModel(producten);

    const productRules = await loadProductDefaultItemsRules(supabaseTemp, ownerEmail);
    const lineItemsJson = productenLijst.length
      ? buildMpLineItemsJson(productenLijst, productRules)
      : null;

    const mpDatumOpmerking = soort === "bezorging"
      ? (((body.datum_voorkeur ?? "").trim().toLowerCase() === "x")
          ? "vandaag"
          : (body.datum_voorkeur ?? "").trim() || null)
      : null;

    const insert = {
      owner_email: ownerEmail,
      source: "mp" as const,
      type: soort === "afhaal" ? ("mp_winkel" as const) : ("verkoop" as const),
      status: soort === "afhaal" ? ("mp_orders" as const) : ("ritjes_vandaag" as const),
      order_nummer: orderNummer,
      naam: naam || null,
      volledig_adres: volledigAdres || null,
      adres_url: mapsUrl,
      telefoon_nummer: telefoonRaw || null,
      telefoon_e164: e164 || null,
      bel_link: belLink,
      email: (body.email ?? "").trim() || null,
      producten,
      bestelling_totaal_prijs: totaalPrijs,
      aantal_fietsen: aantalFietsenBerekend,
      serienummer: soort === "afhaal" ? ((body.serienummer ?? "").trim() || null) : null,
      model: soort === "bezorging" ? modelBerekend : null,
      line_items_json: lineItemsJson,
      datum: datumDb,
      meenemen_in_planning: soort === "bezorging"
        ? defaultMeenemenInPlanning(new Date())
        : false,

      ...(soort === "bezorging" && {
        nieuw_appje_sturen: true,
        betaald: false,
        betaalmethode: null,
        mp_tags: "MP",
        bezorgtijd_voorkeur: ((body.bezorgtijd_voorkeur ?? "").trim().toLowerCase() === "x")
          ? "geen"
          : (body.bezorgtijd_voorkeur ?? "").trim() || null,
        datum_opmerking: mpDatumOpmerking,
        opmerkingen_klant: ((body.opmerking ?? "").trim().toLowerCase() === "x")
          ? "geen opmerking"
          : (body.opmerking ?? "").trim() || null,
      }),

      ...(soort === "afhaal" && {
        bezorger_naam: "winkelverkoop",
        betaalmethode: "contant in winkel",
        betaald_bedrag: totaalPrijs,
        opmerkingen_klant: ((body.opmerking ?? "").trim().toLowerCase() === "x")
          ? "geen opmerking"
          : (body.opmerking ?? "").trim() || null,
      }),
    };

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase
      .from("orders")
      .insert(insert)
      .select("id, order_nummer")
      .single();

    if (error) {
      console.error("[api/mp-order] INSERT fout:", error.message, error.details, error.hint);
      return NextResponse.json(
        { error: "Opslaan mislukt.", detail: error.message },
        { status: 500 }
      );
    }
    console.log("[api/mp-order] INSERT gelukt, id:", data.id, "order_nummer:", data.order_nummer);

    try {
      const deductionLineItems = productenLijst.length
        ? buildMpDeductionLineItems(productenLijst, productRules)
        : undefined;

      if (soort === "afhaal") {
        await deductInventoryForMpOrder(
          supabase,
          ownerEmail,
          data.id,
          data.order_nummer ?? "",
          lineItemsJson,
          producten,
          deductionLineItems
        );
      } else if (deductionLineItems?.length) {
        const { reserveInventoryForMpOrder } = await import("@/lib/inventory-reservations");
        await reserveInventoryForMpOrder(
          supabase,
          ownerEmail,
          data.id,
          data.order_nummer ?? "",
          deductionLineItems,
          {
            customerName: insert.naam ?? null,
            customerPhone: insert.telefoon_e164 ?? insert.telefoon_nummer ?? null,
          }
        );
      }
    } catch (invErr) {
      console.error("[api/mp-order] inventory reserve/deduct:", invErr);
    }

    let garantieError: string | null = null;
    if (soort === "afhaal") {
      try {
        const garantieLink = await verwerkGarantiebewijs(
          {
            order_id: data.id,
            order_nummer: data.order_nummer ?? null,
            naam: insert.naam,
            email: insert.email,
            producten: insert.producten,
            model: insert.model ?? null,
            serienummer: insert.serienummer,
            totaal_prijs: insert.bestelling_totaal_prijs,
            aantal_fietsen: insert.aantal_fietsen,
            datum: new Date().toLocaleDateString("nl-NL"),
          },
          supabase
        );

        await supabase
          .from("orders")
          .update({ link_aankoopbewijs: garantieLink })
          .eq("id", data.id);
      } catch (garantieErr) {
        const msg = garantieErr instanceof Error ? garantieErr.message : String(garantieErr);
        console.error("[api/mp-order] Garantiebewijs fout:", msg, garantieErr);
        garantieError = msg;
      }
    }

    const message =
      soort === "afhaal"
        ? garantieError
          ? "Order opgeslagen in MP orders. Garantiebewijs/email kon niet worden verzonden (zie waarschuwing)."
          : "Order opgeslagen in MP orders. Garantiebewijs aangemaakt en verstuurd naar klant."
        : "Order opgeslagen in Ritjes voor vandaag.";

    return NextResponse.json({
      ok: true,
      id: data.id,
      order_nummer: data.order_nummer,
      message,
      garantieError: garantieError ?? undefined,
    });
  } catch (e) {
    console.error("[api/mp-order]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
