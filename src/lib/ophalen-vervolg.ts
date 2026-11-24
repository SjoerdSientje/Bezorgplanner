/**
 * Vervolg na ophaal-wachtkamer: terugbrengen of winkelafhaal.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mayCreateMoneybirdInvoicesForOwner } from "@/lib/account";
import { defaultMeenemenInPlanning } from "@/lib/planning-date";
import {
  formatPostcodeNl,
  formatVolledigAdres,
  splitVolledigAdres,
} from "@/lib/adres-fields";
import { resolveDutchAddressParts } from "@/lib/pdok-geocode";
import {
  deductInventoryForReparatieOrder,
  reparatieLineItemsForInventoryDeduction,
} from "@/lib/inventory";
import {
  buildReparatieLineItemsJson,
  buildReparatieProductenKolom,
  buildReparatieShopifyLineItems,
  expandReparatieRegelsFromInput,
  listReparatieStandaardItems,
  stripVoorrijFromRegels,
  sumLineItemsIncl,
  type ReparatieBetaalwijze,
  type ReparatieRegelInput,
} from "@/lib/reparaties";
import {
  createReparatieEstimate,
  deleteReparatieEstimate,
  sendReparatieSalesInvoice,
  upsertReparatieSalesInvoice,
  type ReparatieInvoiceLineInput,
} from "@/lib/moneybird";
import { attachMoneybirdFactuurForOrder } from "@/lib/order-factuur";
import { parseOrderMedewerker } from "@/lib/order-medewerker";
import type { ShopifyLineItem } from "@/lib/shopify-order";
import {
  assertMeegenomenTeruggegeven,
  parseOphalenMeegenomenJson,
} from "@/lib/ophalen-meegenomen";

type SrcOrder = Record<string, unknown> & { id: string };

function requireMeegenomenTeruggegeven(src: SrcOrder, body: Record<string, unknown>) {
  const expected = parseOphalenMeegenomenJson(src.ophalen_meegenomen_json);
  const check = assertMeegenomenTeruggegeven(
    expected,
    body.ophalen_meegenomen_teruggegeven
  );
  if (!check.ok) throw new Error(check.error);
  return expected;
}

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

async function enrichAdres(input: {
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
}) {
  let straatnaam = input.straatnaam.trim();
  let huisnummer = input.huisnummer.trim();
  let postcode = input.postcode.trim();
  let woonplaats = input.woonplaats.trim();
  const needsResolve =
    !/^\d{4}\s*[A-Za-z]{2}$/.test(postcode) ||
    !straatnaam ||
    !huisnummer ||
    !woonplaats;
  if (needsResolve && (straatnaam || postcode || woonplaats)) {
    const resolved = await resolveDutchAddressParts({
      straatnaam,
      huisnummer,
      postcode,
      woonplaats,
    });
    if (resolved) {
      straatnaam = straatnaam || resolved.straatnaam;
      huisnummer = huisnummer || resolved.huisnummer;
      if (!/^\d{4}\s*[A-Za-z]{2}$/.test(postcode) && resolved.postcode) {
        postcode = resolved.postcode;
      }
      woonplaats = woonplaats || resolved.woonplaats;
      if (!/^\d{4}\s*[A-Za-z]{2}$/.test(postcode) && resolved.weergavenaam) {
        const m = resolved.weergavenaam.match(/\b(\d{4}\s*[A-Za-z]{2})\b/i);
        if (m) postcode = formatPostcodeNl(m[1]);
      }
    }
  }
  return {
    straatnaam,
    huisnummer,
    postcode,
    woonplaats,
    volledigAdres: formatVolledigAdres({
      straatnaam,
      huisnummer,
      postcode,
      woonplaats,
    }),
  };
}

async function nextReparatieOrderNummer(ownerEmail: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createClient(url, key);
  const { data: laatste } = await sb
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

function pushDualVoorrij(
  expanded: ReparatieRegelInput[],
  ophalenBedrag: number,
  terugbrengenBedrag: number
): number {
  const a = Math.max(0, Math.round(ophalenBedrag * 100) / 100);
  const b = Math.max(0, Math.round(terugbrengenBedrag * 100) / 100);
  if (a >= 0.01) {
    expanded.push({
      kind: "voorrijkosten",
      naam: "Voorrijkosten ophalen",
      voorrij_bedrag: a,
    });
  }
  if (b >= 0.01) {
    expanded.push({
      kind: "voorrijkosten",
      naam: "Voorrijkosten terugbrengen",
      voorrij_bedrag: b,
    });
  }
  return Math.round((a + b) * 100) / 100;
}

function parseMoney(raw: unknown, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n =
    typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function voorrijBasis(src: SrcOrder): number {
  const v = src.voorrij_bedrag;
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

export async function assertOphaalWachtkamerOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderId: string
): Promise<SrcOrder> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("owner_email", ownerEmail)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Order niet gevonden.");
  if (String(data.source) !== "reparatie") {
    throw new Error("Alleen reparatie-orders.");
  }
  if (String(data.type) !== "reparatie_ophalen") {
    throw new Error("Alleen ophaalorders.");
  }
  if (String(data.status) !== "opgehaald") {
    throw new Error("Order staat niet in de ophaal-wachtkamer.");
  }
  if (data.ophalen_afgehandeld_via) {
    throw new Error("Deze ophaalorder is al afgehandeld.");
  }
  return data as SrcOrder;
}

export async function createTerugbrengenFromOphalen(
  supabase: SupabaseClient,
  ownerEmail: string,
  ophaalId: string,
  body: Record<string, unknown>
) {
  const src = await assertOphaalWachtkamerOrder(supabase, ownerEmail, ophaalId);
  const meegenomen = requireMeegenomenTeruggegeven(src, body);

  const betaalwijze = String(body.betaalwijze ?? "") as ReparatieBetaalwijze;
  if (betaalwijze !== "contant" && betaalwijze !== "factuur") {
    throw new Error("Kies contant of factuur.");
  }
  const aangemaaktDoor = parseOrderMedewerker(body.aangemaakt_door);
  if (!aangemaaktDoor) throw new Error("Kies wie deze order aanmaakt.");

  const model = String(body.model ?? src.model ?? "").trim();
  if (!model) throw new Error("Model fiets ontbreekt.");

  const naam = String(body.naam ?? src.naam ?? "").trim();
  const email = String(body.email ?? src.email ?? "").trim().toLowerCase();
  const telefoon = String(body.telefoonnummer ?? src.telefoon_nummer ?? "").trim();

  const enriched = await enrichAdres({
    straatnaam: String(body.straatnaam ?? ""),
    huisnummer: String(body.huisnummer ?? ""),
    postcode: String(body.postcode ?? ""),
    woonplaats: String(body.woonplaats ?? ""),
  });
  if (!naam || !enriched.volledigAdres) {
    throw new Error("Naam en adres zijn verplicht.");
  }

  const standaardItems = await listReparatieStandaardItems(supabase, ownerEmail, {
    includeInactive: true,
  });
  const standaardById = new Map(standaardItems.map((i) => [i.id, i]));
  const rawRegels: ReparatieRegelInput[] = Array.isArray(body.regels)
    ? (body.regels as ReparatieRegelInput[])
    : [];
  const expanded = expandReparatieRegelsFromInput(rawRegels, standaardById);

  const defaultLine = voorrijBasis(src);
  const voorrijOphalen = parseMoney(body.voorrij_ophalen_bedrag, defaultLine);
  const voorrijTerug = parseMoney(body.voorrij_terugbrengen_bedrag, defaultLine);
  const voorrijTotaal = pushDualVoorrij(expanded, voorrijOphalen, voorrijTerug);

  if (stripVoorrijFromRegels(expanded).length === 0) {
    throw new Error("Voeg minstens één reparatieregel toe.");
  }

  const lineItems = buildReparatieShopifyLineItems(expanded);
  const totaal = sumLineItemsIncl(lineItems);
  const productenKolomTekst = String(body.producten_kolom_tekst ?? "").trim();
  const producten = buildReparatieProductenKolom({
    soort: "reparatie_terugbrengen",
    modelnaam: model,
    vrijeTekst: productenKolomTekst || null,
    regels: productenKolomTekst ? [] : stripVoorrijFromRegels(expanded),
    voorrijBedrag: voorrijTotaal,
  });

  const e164 = parsePhoneE164(telefoon);
  const mapsUrl = `https://maps.google.com/maps?q=${encodeURIComponent(enriched.volledigAdres)}`;
  const orderNummer = await nextReparatieOrderNummer(ownerEmail);
  const nu = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" })
  );
  const datumDb = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, "0")}-${String(nu.getDate()).padStart(2, "0")}`;
  const voorrijKm =
    src.voorrij_km != null && Number.isFinite(Number(src.voorrij_km))
      ? Number(src.voorrij_km)
      : null;

  const insert = {
    owner_email: ownerEmail,
    source: "reparatie" as const,
    type: "reparatie_terugbrengen" as const,
    status: "ritjes_vandaag" as const,
    order_nummer: orderNummer,
    naam,
    email: email || null,
    telefoon_nummer: telefoon || null,
    telefoon_e164: e164 || null,
    volledig_adres: enriched.volledigAdres,
    adres_url: mapsUrl,
    bel_link: e164 ? `https://call.ctrlq.org/${e164}` : null,
    bezorgtijd_voorkeur:
      String(body.bezorgtijd_voorkeur ?? "").trim().toLowerCase() === "x"
        ? "geen"
        : String(body.bezorgtijd_voorkeur ?? "").trim() || null,
    datum_opmerking:
      String(body.datum_voorkeur ?? "").trim().toLowerCase() === "x"
        ? "vandaag"
        : String(body.datum_voorkeur ?? "").trim() || null,
    opmerkingen_klant:
      String(body.opmerking ?? "").trim().toLowerCase() === "x"
        ? "geen opmerking"
        : String(body.opmerking ?? "").trim() || null,
    achtergrondverhaal:
      String(body.achtergrondverhaal ?? src.achtergrondverhaal ?? "").trim() || null,
    aangemaakt_door: aangemaaktDoor,
    model,
    producten,
    line_items_json: buildReparatieLineItemsJson(lineItems),
    bestelling_totaal_prijs: Math.round(totaal * 100) / 100,
    aantal_fietsen: 0,
    betaald: false,
    al_betaald: 0,
    te_betalen: Math.round(totaal * 100) / 100,
    reparatie_betaalwijze: betaalwijze,
    producten_nog_niet_bekend: false,
    fiets_ook_opgehaald: true,
    voorrij_km: voorrijKm,
    voorrij_bedrag: voorrijTotaal || null,
    reparatie_regels_json: stripVoorrijFromRegels(expanded),
    meenemen_in_planning: defaultMeenemenInPlanning(new Date()),
    datum: datumDb,
    gekoppeld_ophalen_order_id: src.id,
    ophalen_meegenomen_json: meegenomen,
    moneybird_invoice_id: null as string | null,
  };

  const { data: order, error } = await supabase
    .from("orders")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await supabase
    .from("orders")
    .update({ ophalen_afgehandeld_via: "terugbrengen" })
    .eq("id", src.id)
    .eq("owner_email", ownerEmail);

  let moneybirdInvoiceId: string | null = null;
  const allowMoneybird = mayCreateMoneybirdInvoicesForOwner(ownerEmail);
  if (allowMoneybird && betaalwijze === "factuur") {
    const { first, last } = splitName(naam);
    // Factuurcontact: ophaal-adres (MB-klant), niet eventueel ander terugbrengadres.
    const srcAdres = String(src.volledig_adres ?? "");
    const inv = await upsertReparatieSalesInvoice({
      orderId: order.id,
      orderNummer,
      contact: {
        email: email || "onbekend@koopjefatbike.nl",
        firstname: first,
        lastname: last,
        phone: e164 || telefoon,
        address1: srcAdres.split(",")[0]?.trim() || enriched.straatnaam,
        zipcode: enriched.postcode,
        city: enriched.woonplaats,
      },
      lines: lineItemsToInvoiceLines(lineItems),
    });
    moneybirdInvoiceId = inv?.id ?? null;
    if (!moneybirdInvoiceId) {
      throw new Error("Moneybird-factuur aanmaken mislukt.");
    }
    await supabase
      .from("orders")
      .update({ moneybird_invoice_id: moneybirdInvoiceId })
      .eq("id", order.id);

    try {
      await deductInventoryForReparatieOrder(
        supabase,
        ownerEmail,
        order.id,
        orderNummer,
        reparatieLineItemsForInventoryDeduction(lineItems)
      );
    } catch (invErr) {
      console.error("[ophalen-vervolg] inventory deduct:", invErr);
    }

    const sendRes = await sendReparatieSalesInvoice({
      orderId: order.id,
      invoiceId: moneybirdInvoiceId,
      email: email || null,
    });
    if (!sendRes.sent) {
      const skipped = String(sendRes.skipped ?? "");
      if (!(skipped.startsWith("state_") && !skipped.includes("draft"))) {
        throw new Error(
          `Factuur niet verzonden: ${sendRes.error || skipped || "onbekend"}`
        );
      }
    }
  } else {
    try {
      await deductInventoryForReparatieOrder(
        supabase,
        ownerEmail,
        order.id,
        orderNummer,
        reparatieLineItemsForInventoryDeduction(lineItems)
      );
    } catch (invErr) {
      console.error("[ophalen-vervolg] inventory deduct:", invErr);
    }
  }

  return {
    order: { ...order, moneybird_invoice_id: moneybirdInvoiceId },
  };
}

export async function completeWinkelafhaalFromOphalen(
  supabase: SupabaseClient,
  ownerEmail: string,
  ophaalId: string,
  body: Record<string, unknown>
) {
  const src = await assertOphaalWachtkamerOrder(supabase, ownerEmail, ophaalId);
  requireMeegenomenTeruggegeven(src, body);

  const model = String(body.model ?? src.model ?? "").trim();
  if (!model) throw new Error("Model fiets ontbreekt.");

  const standaardItems = await listReparatieStandaardItems(supabase, ownerEmail, {
    includeInactive: true,
  });
  const standaardById = new Map(standaardItems.map((i) => [i.id, i]));
  const rawRegels: ReparatieRegelInput[] = Array.isArray(body.regels)
    ? (body.regels as ReparatieRegelInput[])
    : [];
  const expanded = expandReparatieRegelsFromInput(rawRegels, standaardById);
  if (stripVoorrijFromRegels(expanded).length === 0) {
    throw new Error("Voeg minstens één reparatieregel toe.");
  }

  const defaultVoorrij = voorrijBasis(src);
  const voorrijBedrag = parseMoney(
    body.voorrij_ophalen_bedrag ?? body.voorrij_bedrag,
    defaultVoorrij
  );
  if (voorrijBedrag >= 0.01) {
    expanded.push({
      kind: "voorrijkosten",
      naam: "Voorrijkosten",
      voorrij_bedrag: Math.round(voorrijBedrag * 100) / 100,
    });
  }

  const lineItems = buildReparatieShopifyLineItems(expanded);
  const totaal = sumLineItemsIncl(lineItems);
  const productenKolomTekst = String(body.producten_kolom_tekst ?? "").trim();
  const producten = buildReparatieProductenKolom({
    soort: "reparatie_ophalen",
    modelnaam: model,
    vrijeTekst: productenKolomTekst || null,
    regels: productenKolomTekst ? [] : stripVoorrijFromRegels(expanded),
    voorrijBedrag: voorrijBedrag > 0 ? voorrijBedrag : null,
  });

  const achtergrond =
    String(body.achtergrondverhaal ?? src.achtergrondverhaal ?? "").trim() || null;

  const nowIso = new Date().toISOString();
  const bezorgdatum = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Amsterdam",
  });

  let estimateId: string | null = null;
  let estimateNumber: string | null = null;
  const allowMoneybird = mayCreateMoneybirdInvoicesForOwner(ownerEmail);
  if (allowMoneybird) {
    const naam = String(src.naam ?? "").trim() || "Klant";
    const email = String(src.email ?? "").trim().toLowerCase();
    const telefoon = String(src.telefoon_nummer ?? "").trim();
    const e164 = parsePhoneE164(telefoon);
    const { first, last } = splitName(naam);
    const estimate = await createReparatieEstimate({
      orderId: src.id,
      orderNummer: String(src.order_nummer ?? src.id),
      contact: {
        email: email || "onbekend@koopjefatbike.nl",
        firstname: first,
        lastname: last,
        phone: e164 || telefoon,
        address1: String(src.volledig_adres ?? "").split(",")[0]?.trim() || "",
        zipcode: "",
        city: "",
      },
      lines: lineItemsToInvoiceLines(lineItems),
    });
    estimateId = estimate?.id ?? null;
    estimateNumber = String(estimate?.estimate_id ?? "").trim() || null;
    if (!estimateId) {
      throw new Error("Moneybird-conceptofferte aanmaken mislukt.");
    }
  }

  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      status: "bezorgd",
      afgerond_at: nowIso,
      datum: bezorgdatum,
      model,
      producten,
      line_items_json: buildReparatieLineItemsJson(lineItems),
      bestelling_totaal_prijs: Math.round(totaal * 100) / 100,
      te_betalen: Math.round(totaal * 100) / 100,
      voorrij_bedrag: voorrijBedrag > 0 ? voorrijBedrag : null,
      reparatie_regels_json: stripVoorrijFromRegels(expanded),
      achtergrondverhaal: achtergrond,
      ophalen_afgehandeld_via: "winkelafhaal",
      moneybird_estimate_id: estimateId,
      moneybird_estimate_number: estimateNumber,
      reparatie_betaalwijze: "factuur",
    })
    .eq("id", src.id)
    .eq("owner_email", ownerEmail)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return {
    order: updated,
    estimateNumber,
  };
}

const WINKELAFHAAL_REVIEW_DAYS = 7;

function parseStoredLineItems(raw: unknown): ShopifyLineItem[] {
  if (!raw) return [];
  try {
    const parsed =
      typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (!Array.isArray(parsed)) return [];
    const out: ShopifyLineItem[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const r = entry as Record<string, unknown>;
      const name = String(r.name ?? r.title ?? "").trim();
      if (!name) continue;
      const priceRaw = r.price;
      const price =
        typeof priceRaw === "number" || typeof priceRaw === "string"
          ? priceRaw
          : 0;
      out.push({
        name,
        price,
        quantity: Math.max(1, Math.floor(Number(r.quantity ?? 1) || 1)),
        product_id:
          typeof r.product_id === "number" || typeof r.product_id === "string"
            ? r.product_id
            : null,
        variant_id:
          typeof r.variant_id === "number" || typeof r.variant_id === "string"
            ? r.variant_id
            : null,
        properties: Array.isArray(r.properties)
          ? (r.properties as ShopifyLineItem["properties"])
          : [],
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Winkelafhaal ≤7 dagen geleden, nog zonder factuur (conceptofferte open). */
export async function listRecenteWinkelafhaal(
  supabase: SupabaseClient,
  ownerEmail: string
) {
  const since = new Date();
  since.setDate(since.getDate() - WINKELAFHAAL_REVIEW_DAYS);
  const sinceIso = since.toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_nummer, naam, email, telefoon_nummer, producten, model, afgerond_at, moneybird_estimate_id, moneybird_estimate_number, moneybird_invoice_id, bestelling_totaal_prijs, volledig_adres"
    )
    .eq("owner_email", ownerEmail)
    .eq("source", "reparatie")
    .eq("type", "reparatie_ophalen")
    .eq("status", "bezorgd")
    .eq("ophalen_afgehandeld_via", "winkelafhaal")
    .is("moneybird_invoice_id", null)
    .gte("afgerond_at", sinceIso)
    .order("afgerond_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function assertRecentWinkelafhaalOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderId: string
): Promise<SrcOrder> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("owner_email", ownerEmail)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Order niet gevonden.");
  if (String(data.source) !== "reparatie" || String(data.type) !== "reparatie_ophalen") {
    throw new Error("Alleen ophaal/winkelafhaal-orders.");
  }
  if (String(data.status) !== "bezorgd") {
    throw new Error("Order staat niet als winkelafhaal/bezorgd.");
  }
  if (String(data.ophalen_afgehandeld_via ?? "") !== "winkelafhaal") {
    throw new Error("Geen recente winkelafhaal-order.");
  }
  if (data.moneybird_invoice_id) {
    throw new Error("Deze order is al gefactureerd.");
  }
  const afgerond = data.afgerond_at ? new Date(String(data.afgerond_at)) : null;
  if (!afgerond || Number.isNaN(afgerond.getTime())) {
    throw new Error("Afronddatum ontbreekt.");
  }
  const ageMs = Date.now() - afgerond.getTime();
  if (ageMs > WINKELAFHAAL_REVIEW_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(
      `Deze winkelafhaal is ouder dan ${WINKELAFHAAL_REVIEW_DAYS} dagen — handel af in Moneybird.`
    );
  }
  return data as SrcOrder;
}

/**
 * Conceptofferte → echte factuur + verzenden (zelfde pad als reparatie-factuur).
 * Conceptofferte wordt daarna verwijderd indien nog draft.
 */
export async function factureerWinkelafhaalEstimate(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderId: string
) {
  const order = await assertRecentWinkelafhaalOrder(supabase, ownerEmail, orderId);
  if (!mayCreateMoneybirdInvoicesForOwner(ownerEmail)) {
    throw new Error("Moneybird-facturen niet beschikbaar voor dit account.");
  }

  const lineItems = parseStoredLineItems(order.line_items_json);
  if (lineItems.length === 0) {
    throw new Error("Geen factuurregels op de order.");
  }

  const naam = String(order.naam ?? "").trim() || "Klant";
  const email = String(order.email ?? "").trim().toLowerCase();
  const telefoon = String(order.telefoon_nummer ?? "").trim();
  const e164 = parsePhoneE164(telefoon);
  const { first, last } = splitName(naam);
  const adres = splitVolledigAdres(String(order.volledig_adres ?? ""));

  const inv = await upsertReparatieSalesInvoice({
    orderId: order.id,
    orderNummer: String(order.order_nummer ?? order.id),
    contact: {
      email: email || "onbekend@koopjefatbike.nl",
      firstname: first,
      lastname: last,
      phone: e164 || telefoon,
      address1: adres.straatnaam
        ? `${adres.straatnaam} ${adres.huisnummer}`.trim()
        : String(order.volledig_adres ?? "").split(",")[0]?.trim() || "",
      zipcode: adres.postcode,
      city: adres.woonplaats,
    },
    lines: lineItemsToInvoiceLines(lineItems),
  });
  if (!inv?.id) throw new Error("Factuur aanmaken mislukt.");

  const sent = await sendReparatieSalesInvoice({
    orderId: order.id,
    invoiceId: inv.id,
    email: email || null,
  });
  if (!sent.sent && !String(sent.skipped ?? "").startsWith("state_")) {
    throw new Error(
      sent.error || sent.skipped || "Factuur verzenden mislukt."
    );
  }

  try {
    await deductInventoryForReparatieOrder(
      supabase,
      ownerEmail,
      order.id,
      String(order.order_nummer ?? order.id),
      reparatieLineItemsForInventoryDeduction(lineItems)
    );
  } catch (invErr) {
    console.error("[ophalen-vervolg] inventory deduct bij factuur:", invErr);
  }

  try {
    await deleteReparatieEstimate({
      orderId: order.id,
      estimateId: order.moneybird_estimate_id
        ? String(order.moneybird_estimate_id)
        : null,
    });
  } catch (err) {
    console.warn("[ophalen-vervolg] estimate delete na factuur:", err);
  }

  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      moneybird_invoice_id: inv.id,
      reparatie_betaalwijze: "factuur",
    })
    .eq("id", order.id)
    .eq("owner_email", ownerEmail)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  try {
    await attachMoneybirdFactuurForOrder(supabase, {
      id: order.id,
      owner_email: ownerEmail,
      source: "reparatie",
      type: "reparatie_ophalen",
      status: "bezorgd",
      order_nummer: String(order.order_nummer ?? ""),
      email,
      moneybird_invoice_id: inv.id,
      link_factuur: null,
      mp_tags: null,
    });
  } catch (err) {
    console.warn("[ophalen-vervolg] factuur-pdf koppelen:", err);
  }

  return { order: updated, invoiceId: inv.id, sent };
}

/**
 * Winkelafhaal terugdraaien → weer in ophaal-wachtkamer (conceptofferte weg).
 * Daarna kan normaal "Fiets terugbrengen" gekozen worden.
 */
export async function heropenWinkelafhaalNaarOphalen(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderId: string
) {
  const order = await assertRecentWinkelafhaalOrder(supabase, ownerEmail, orderId);

  try {
    await deleteReparatieEstimate({
      orderId: order.id,
      estimateId: order.moneybird_estimate_id
        ? String(order.moneybird_estimate_id)
        : null,
    });
  } catch (err) {
    console.warn("[ophalen-vervolg] estimate delete bij heropenen:", err);
  }

  const model = String(order.model ?? "").trim();
  const voorrijBedrag =
    order.voorrij_bedrag != null && Number.isFinite(Number(order.voorrij_bedrag))
      ? Number(order.voorrij_bedrag)
      : null;
  const producten = buildReparatieProductenKolom({
    soort: "reparatie_ophalen",
    modelnaam: model || null,
    voorrijBedrag,
  });

  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      status: "opgehaald",
      afgerond_at: null,
      ophalen_afgehandeld_via: null,
      moneybird_estimate_id: null,
      moneybird_estimate_number: null,
      moneybird_invoice_id: null,
      producten,
      line_items_json: buildReparatieLineItemsJson([]),
      reparatie_regels_json: [],
      bestelling_totaal_prijs: voorrijBedrag ?? 0,
      te_betalen: voorrijBedrag ?? 0,
      reparatie_betaalwijze: "contant",
    })
    .eq("id", order.id)
    .eq("owner_email", ownerEmail)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return { order: updated };
}
