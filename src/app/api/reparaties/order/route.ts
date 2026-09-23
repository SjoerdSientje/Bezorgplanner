import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { defaultMeenemenInPlanning } from "@/lib/planning-date";
import {
  buildReparatieLineItemsJson,
  buildReparatieShopifyLineItems,
  calcVoorrijkostenForAddress,
  listReparatieStandaardItems,
  productenTekstFromLineItems,
  stripVoorrijFromRegels,
  sumLineItemsIncl,
  type ReparatieBetaalwijze,
  type ReparatieRegelInput,
  type ReparatieSoort,
} from "@/lib/reparaties";
import {
  deleteReparatieSalesInvoice,
  upsertReparatieSalesInvoice,
  type ReparatieInvoiceLineInput,
} from "@/lib/moneybird";
import type { ShopifyLineItem } from "@/lib/shopify-order";

export const dynamic = "force-dynamic";

function parsePhoneE164(raw: string): string {
  const telefoonRaw = raw.replace(/[\s\-()]/g, "");
  if (!telefoonRaw) return "";
  if (telefoonRaw.startsWith("+")) return telefoonRaw;
  if (telefoonRaw.startsWith("0")) return "+31" + telefoonRaw.slice(1);
  return telefoonRaw;
}

function splitName(naam: string): { first: string; last: string } {
  const parts = naam.trim().split(/\s+/);
  if (parts.length <= 1) return { first: "", last: parts[0] || "Klant" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

function lineItemsToInvoiceLines(items: ShopifyLineItem[]): ReparatieInvoiceLineInput[] {
  return items.map((li) => ({
    description: String(li.name ?? ""),
    priceIncl:
      typeof li.price === "number"
        ? li.price
        : parseFloat(String(li.price ?? 0)) || 0,
    quantity: Math.max(1, Math.floor(Number(li.quantity ?? 1))),
    shopifyProductId: li.product_id != null ? Number(li.product_id) : null,
  }));
}

async function nextReparatieOrderNummer(
  ownerEmail: string
): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(url, key);
  const { data: laatste } = await supabase
    .from("orders")
    .select("order_nummer")
    .eq("owner_email", ownerEmail)
    .like("order_nummer", "#REP%")
    .order("order_nummer", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prev = laatste?.order_nummer
    ? parseInt(String(laatste.order_nummer).replace("#REP", ""), 10)
    : 999;
  return `#REP${Number.isFinite(prev) ? prev + 1 : 1000}`;
}

/** GET — geplande reparaties (ritjes_vandaag of gepland). */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .in("type", [
        "reparatie_deur",
        "reparatie_ophalen",
        "reparatie_terugbrengen",
      ])
      .in("status", ["ritjes_vandaag", "gepland"])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ orders: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ophalen mislukt.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

/** POST — nieuwe reparatie-order. */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json();
    const supabase = createServerSupabaseClient();

    const soort = String(body.soort ?? "") as ReparatieSoort;
    if (
      !["reparatie_deur", "reparatie_ophalen", "reparatie_terugbrengen"].includes(
        soort
      )
    ) {
      return NextResponse.json({ error: "Ongeldig type." }, { status: 400 });
    }

    const betaalwijze = String(body.betaalwijze ?? "") as ReparatieBetaalwijze;
    if (!["contant", "factuur"].includes(betaalwijze)) {
      return NextResponse.json(
        { error: "Kies contant of factuur." },
        { status: 400 }
      );
    }

    const naam = String(body.naam ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const telefoon = String(body.telefoonnummer ?? "").trim();
    const straat = String(body.straatnaam ?? "").trim();
    const huisnr = String(body.huisnummer ?? "").trim();
    const postcode = String(body.postcode ?? "").trim();
    const woonplaats = String(body.woonplaats ?? "").trim();
    const volledigAdres = [straat, huisnr, postcode, woonplaats]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!naam || !volledigAdres) {
      return NextResponse.json(
        { error: "Naam en adres zijn verplicht." },
        { status: 400 }
      );
    }

    const productenNogNietBekend =
      soort === "reparatie_deur" && Boolean(body.producten_nog_niet_bekend);

    const standaardItems = await listReparatieStandaardItems(supabase, ownerEmail, {
      includeInactive: true,
    });
    const standaardById = new Map(standaardItems.map((i) => [i.id, i]));

    const rawRegels: ReparatieRegelInput[] = Array.isArray(body.regels)
      ? body.regels
      : [];

    const expanded: ReparatieRegelInput[] = [];
    for (const r of rawRegels) {
      if (r.kind === "standaard" && r.standaard_id) {
        const s = standaardById.get(String(r.standaard_id));
        if (!s) continue;
        expanded.push({
          kind: "standaard",
          standaard_id: s.id,
          naam: s.naam,
          onderdeel_naam: s.onderdeel_naam || s.naam,
          onderdeel_prijs_incl: Number(s.onderdeel_prijs_incl) || 0,
          shopify_product_id: s.shopify_product_id,
          shopify_variant_id: s.shopify_variant_id,
          arbeid_uren: Number(s.arbeid_uren) || 0,
        });
      } else if (r.kind === "custom") {
        expanded.push({
          kind: "custom",
          naam: String(r.naam ?? "").trim() || "Reparatie",
          onderdeel_naam: String(r.onderdeel_naam ?? r.naam ?? "").trim(),
          onderdeel_prijs_incl: Number(r.onderdeel_prijs_incl) || 0,
          shopify_product_id: r.shopify_product_id ?? null,
          shopify_variant_id: r.shopify_variant_id ?? null,
          arbeid_uren: Number(r.arbeid_uren) || 0,
        });
      }
    }

    let voorrijKm: number | null = null;
    let voorrijBedrag: number | null = null;
    try {
      const vr = await calcVoorrijkostenForAddress(
        supabase,
        ownerEmail,
        volledigAdres
      );
      voorrijKm = vr.km;
      voorrijBedrag = vr.bedrag;
      if (voorrijBedrag >= 0.01) {
        expanded.push({
          kind: "voorrijkosten",
          naam: "Voorrijkosten",
          voorrij_bedrag: voorrijBedrag,
        });
      }
    } catch (err) {
      console.warn("[reparaties] voorrijkosten berekening:", err);
    }

    if (
      soort === "reparatie_deur" &&
      !productenNogNietBekend &&
      expanded.filter((r) => r.kind !== "voorrijkosten").length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Voeg minstens één reparatieregel toe, of kies ‘producten nog niet bekend’.",
        },
        { status: 400 }
      );
    }

    const lineItems = productenNogNietBekend
      ? buildReparatieShopifyLineItems(
          expanded.filter((r) => r.kind === "voorrijkosten")
        )
      : buildReparatieShopifyLineItems(expanded);

    // Placeholder-regel zodat order zichtbaar is als producten onbekend
    if (productenNogNietBekend) {
      lineItems.unshift({
        name: "Producten nog niet bekend",
        price: 0,
        quantity: 1,
        properties: [{ name: "Status", value: "onbekend" }],
      });
    }

    const totaal = sumLineItemsIncl(lineItems);
    const producten = productenTekstFromLineItems(lineItems);
    const lineItemsJson = buildReparatieLineItemsJson(lineItems);

    const e164 = parsePhoneE164(telefoon);
    const mapsUrl = `https://maps.google.com/maps?q=${encodeURIComponent(volledigAdres)}`;
    const belLink = e164 ? `https://call.ctrlq.org/${e164}` : null;

    const nu = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" })
    );
    const dd = String(nu.getDate()).padStart(2, "0");
    const mm = String(nu.getMonth() + 1).padStart(2, "0");
    const yyyy = nu.getFullYear();
    const datumDb = `${yyyy}-${mm}-${dd}`;

    const orderNummer = await nextReparatieOrderNummer(ownerEmail);
    const datumOpmerking =
      String(body.datum_voorkeur ?? "").trim().toLowerCase() === "x"
        ? "vandaag"
        : String(body.datum_voorkeur ?? "").trim() || null;

    const insert = {
      owner_email: ownerEmail,
      source: "reparatie",
      type: soort,
      status: "ritjes_vandaag",
      order_nummer: orderNummer,
      naam,
      email: email || null,
      telefoon_nummer: telefoon || null,
      telefoon_e164: e164 || null,
      volledig_adres: volledigAdres,
      adres_url: mapsUrl,
      bel_link: belLink,
      bezorgtijd_voorkeur: String(body.bezorgtijd_voorkeur ?? "").trim() || null,
      datum_opmerking: datumOpmerking,
      opmerkingen_klant: String(body.opmerking ?? "").trim() || null,
      producten,
      line_items_json: lineItemsJson,
      bestelling_totaal_prijs: Math.round(totaal * 100) / 100,
      aantal_fietsen: 0,
      betaald: false,
      betaalmethode: null,
      reparatie_betaalwijze: betaalwijze,
      producten_nog_niet_bekend: productenNogNietBekend,
      voorrij_km: voorrijKm,
      voorrij_bedrag: voorrijBedrag,
      reparatie_regels_json: productenNogNietBekend
        ? []
        : stripVoorrijFromRegels(expanded),
      meenemen_in_planning: defaultMeenemenInPlanning(new Date()),
      datum: datumDb,
      mp_tags: null,
      moneybird_invoice_id: null as string | null,
    };

    const { data: order, error } = await supabase
      .from("orders")
      .insert(insert)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    let moneybirdInvoiceId: string | null = null;
    if (betaalwijze === "factuur" && !productenNogNietBekend) {
      const { first, last } = splitName(naam);
      try {
        const inv = await upsertReparatieSalesInvoice({
          orderId: order.id,
          orderNummer,
          contact: {
            email: email || "onbekend@koopjefatbike.nl",
            firstname: first,
            lastname: last,
            phone: e164 || telefoon,
            address1: [straat, huisnr].filter(Boolean).join(" "),
            zipcode: postcode,
            city: woonplaats,
          },
          lines: lineItemsToInvoiceLines(
            lineItems.filter(
              (li) => String(li.name).toLowerCase() !== "producten nog niet bekend"
            )
          ),
        });
        moneybirdInvoiceId = inv?.id ?? null;
        if (moneybirdInvoiceId) {
          await supabase
            .from("orders")
            .update({ moneybird_invoice_id: moneybirdInvoiceId })
            .eq("id", order.id);
        }
      } catch (mbErr) {
        console.error("[reparaties] moneybird create:", mbErr);
      }
    }

    return NextResponse.json({
      order: { ...order, moneybird_invoice_id: moneybirdInvoiceId },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Aanmaken mislukt.";
    console.error("[reparaties] create:", e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** PATCH — bewerk geplande reparatie (na bevestiging). */
export async function PATCH(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json();
    const orderId = String(body.id ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "id verplicht." }, { status: 400 });
    }
    const supabase = createServerSupabaseClient();

    const { data: existing, error: fetchErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("owner_email", ownerEmail)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) {
      return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
    }
    if (!["ritjes_vandaag", "gepland"].includes(String(existing.status))) {
      return NextResponse.json(
        { error: "Alleen openstaande reparaties kunnen worden bewerkt." },
        { status: 400 }
      );
    }

    const soort = (String(body.soort ?? existing.type) ||
      existing.type) as ReparatieSoort;
    const betaalwijze = String(
      body.betaalwijze ?? existing.reparatie_betaalwijze ?? "factuur"
    ) as ReparatieBetaalwijze;

    const naam = String(body.naam ?? existing.naam ?? "").trim();
    const email = String(body.email ?? existing.email ?? "")
      .trim()
      .toLowerCase();
    const telefoon = String(
      body.telefoonnummer ?? existing.telefoon_nummer ?? ""
    ).trim();
    const straat = String(body.straatnaam ?? "").trim();
    const huisnr = String(body.huisnummer ?? "").trim();
    const postcode = String(body.postcode ?? "").trim();
    const woonplaats = String(body.woonplaats ?? "").trim();
    let volledigAdres = [straat, huisnr, postcode, woonplaats]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!volledigAdres) {
      volledigAdres = String(existing.volledig_adres ?? "").trim();
    }

    const productenNogNietBekend =
      soort === "reparatie_deur" &&
      (body.producten_nog_niet_bekend != null
        ? Boolean(body.producten_nog_niet_bekend)
        : Boolean(existing.producten_nog_niet_bekend));

    const standaardItems = await listReparatieStandaardItems(supabase, ownerEmail, {
      includeInactive: true,
    });
    const standaardById = new Map(standaardItems.map((i) => [i.id, i]));
    const rawRegels: ReparatieRegelInput[] = Array.isArray(body.regels)
      ? body.regels
      : [];

    const expanded: ReparatieRegelInput[] = [];
    for (const r of rawRegels) {
      if (r.kind === "standaard" && r.standaard_id) {
        const s = standaardById.get(String(r.standaard_id));
        if (!s) continue;
        expanded.push({
          kind: "standaard",
          standaard_id: s.id,
          naam: s.naam,
          onderdeel_naam: s.onderdeel_naam || s.naam,
          onderdeel_prijs_incl: Number(s.onderdeel_prijs_incl) || 0,
          shopify_product_id: s.shopify_product_id,
          shopify_variant_id: s.shopify_variant_id,
          arbeid_uren: Number(s.arbeid_uren) || 0,
        });
      } else if (r.kind === "custom") {
        expanded.push({
          kind: "custom",
          naam: String(r.naam ?? "").trim() || "Reparatie",
          onderdeel_naam: String(r.onderdeel_naam ?? r.naam ?? "").trim(),
          onderdeel_prijs_incl: Number(r.onderdeel_prijs_incl) || 0,
          shopify_product_id: r.shopify_product_id ?? null,
          shopify_variant_id: r.shopify_variant_id ?? null,
          arbeid_uren: Number(r.arbeid_uren) || 0,
        });
      }
    }

    let voorrijKm = existing.voorrij_km != null ? Number(existing.voorrij_km) : null;
    let voorrijBedrag =
      existing.voorrij_bedrag != null ? Number(existing.voorrij_bedrag) : null;
    if (volledigAdres) {
      try {
        const vr = await calcVoorrijkostenForAddress(
          supabase,
          ownerEmail,
          volledigAdres
        );
        voorrijKm = vr.km;
        voorrijBedrag = vr.bedrag;
      } catch {
        /* keep existing */
      }
    }
    if (voorrijBedrag != null && voorrijBedrag >= 0.01) {
      expanded.push({
        kind: "voorrijkosten",
        naam: "Voorrijkosten",
        voorrij_bedrag: voorrijBedrag,
      });
    }

    const lineItems = productenNogNietBekend
      ? buildReparatieShopifyLineItems(
          expanded.filter((r) => r.kind === "voorrijkosten")
        )
      : buildReparatieShopifyLineItems(expanded);

    if (productenNogNietBekend) {
      lineItems.unshift({
        name: "Producten nog niet bekend",
        price: 0,
        quantity: 1,
        properties: [{ name: "Status", value: "onbekend" }],
      });
    }

    const totaal = sumLineItemsIncl(lineItems);
    const e164 = parsePhoneE164(telefoon);
    const mapsUrl = volledigAdres
      ? `https://maps.google.com/maps?q=${encodeURIComponent(volledigAdres)}`
      : existing.adres_url;
    const datumOpmerking =
      body.datum_voorkeur != null
        ? String(body.datum_voorkeur).trim().toLowerCase() === "x"
          ? "vandaag"
          : String(body.datum_voorkeur).trim() || null
        : existing.datum_opmerking;

    const update = {
      type: soort,
      naam,
      email: email || null,
      telefoon_nummer: telefoon || null,
      telefoon_e164: e164 || null,
      volledig_adres: volledigAdres || existing.volledig_adres,
      adres_url: mapsUrl,
      bel_link: e164 ? `https://call.ctrlq.org/${e164}` : existing.bel_link,
      bezorgtijd_voorkeur:
        body.bezorgtijd_voorkeur != null
          ? String(body.bezorgtijd_voorkeur).trim() || null
          : existing.bezorgtijd_voorkeur,
      datum_opmerking: datumOpmerking,
      opmerkingen_klant:
        body.opmerking != null
          ? String(body.opmerking).trim() || null
          : existing.opmerkingen_klant,
      producten: productenTekstFromLineItems(lineItems),
      line_items_json: buildReparatieLineItemsJson(lineItems),
      bestelling_totaal_prijs: Math.round(totaal * 100) / 100,
      reparatie_betaalwijze: betaalwijze,
      producten_nog_niet_bekend: productenNogNietBekend,
      voorrij_km: voorrijKm,
      voorrij_bedrag: voorrijBedrag,
      reparatie_regels_json: productenNogNietBekend
        ? []
        : stripVoorrijFromRegels(expanded),
      updated_at: new Date().toISOString(),
    };

    const { data: order, error } = await supabase
      .from("orders")
      .update(update)
      .eq("id", orderId)
      .eq("owner_email", ownerEmail)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    let moneybirdInvoiceId = existing.moneybird_invoice_id as string | null;

    if (betaalwijze === "contant" || productenNogNietBekend) {
      try {
        await deleteReparatieSalesInvoice({
          orderId,
          invoiceId: moneybirdInvoiceId,
        });
      } catch (e) {
        console.error("[reparaties] moneybird delete:", e);
      }
      moneybirdInvoiceId = null;
    } else {
      const { first, last } = splitName(naam);
      try {
        const inv = await upsertReparatieSalesInvoice({
          orderId,
          orderNummer: String(order.order_nummer ?? orderId),
          existingInvoiceId: moneybirdInvoiceId,
          contact: {
            email: email || "onbekend@koopjefatbike.nl",
            firstname: first,
            lastname: last,
            phone: e164 || telefoon,
            address1: volledigAdres,
            zipcode: postcode,
            city: woonplaats,
          },
          lines: lineItemsToInvoiceLines(
            lineItems.filter(
              (li) =>
                String(li.name).toLowerCase() !== "producten nog niet bekend"
            )
          ),
        });
        moneybirdInvoiceId = inv?.id ?? moneybirdInvoiceId;
      } catch (e) {
        console.error("[reparaties] moneybird upsert:", e);
      }
    }

    await supabase
      .from("orders")
      .update({ moneybird_invoice_id: moneybirdInvoiceId })
      .eq("id", orderId);

    return NextResponse.json({
      order: { ...order, moneybird_invoice_id: moneybirdInvoiceId },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Opslaan mislukt.";
    console.error("[reparaties] patch:", e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
