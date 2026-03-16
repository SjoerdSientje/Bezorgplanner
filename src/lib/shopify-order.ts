/**
 * Shopify order → Ritjes voor vandaag
 * Filter, veldmapping en hulpfuncties.
 */

export interface ShopifyAddress {
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
  phone?: string | null;
}

export interface ShopifyCustomer {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ShopifyLineItemProperty {
  name?: string | null;
  value?: string | null;
}

export interface ShopifyLineItem {
  name?: string | null;
  price?: string | number | null;
  properties?: ShopifyLineItemProperty[] | null;
}

export interface ShopifyOrder {
  id?: string | number | null;
  name?: string | null;
  total_price?: string | number | null;
  tags?: string | null;
  note?: string | null;
  financial_status?: string | null;
  created_at?: string | null;
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[] | null;
}

/** Order komt alleen in Ritjes voor vandaag als hij door dit filter gaat */
export function passesRitjesFilter(order: ShopifyOrder): boolean {
  const totalPrice = parseFloat(String(order.total_price ?? 0));
  const tags = (order.tags ?? "").toLowerCase();

  const hasWinkel = tags.includes("winkel");
  const hasTerugbrengen = tags.includes("terugbrengen");
  const hasOphalen = tags.includes("ophalen");
  const hasReparatieAanHuis = tags.includes("reparatie aan huis");
  const hasProefrit = tags.includes("proefrit");

  if (hasTerugbrengen || hasOphalen || hasReparatieAanHuis || hasProefrit) return true;
  if (totalPrice > 500 && !hasWinkel) return true;
  return false;
}

function ifempty(...values: (string | null | undefined)[]): string {
  for (const v of values) {
    const s = v != null ? String(v).trim() : "";
    if (s && s !== "geen nummer" && s !== "geen email") return s;
  }
  return "";
}

/** Nederlandse telefoon naar E.164 (+31...) */
export function phoneToE164(phone: string | null | undefined): string {
  let n = (phone ?? "").replace(/\D/g, "");
  if (!n) return "";
  if (n.startsWith("31") && n.length >= 11) return `+${n}`;
  if (n.startsWith("0")) return "+31" + n.slice(1);
  if (n.length <= 9) return "+31" + n;
  return "+" + n;
}

/** Parsed notitie: Tijd / Datum / Opmerking */
export function parseNote(note: string | null | undefined): {
  bezorgtijdVoorkeur: string;
  datumOpmerking: string;
  opmerkingenKlant: string;
} {
  const def = {
    bezorgtijdVoorkeur: "geen",
    datumOpmerking: "vandaag",
    opmerkingenKlant: "geen opmerking",
  };
  const text = (note ?? "").trim();
  if (!text) return def;

  const lower = text.toLowerCase();
  const out = { ...def };

  if (lower.includes("tijd")) {
    const match = text.match(/(?:tijd|Tijd)\s*[:\-]?\s*([^\n]+)/i);
    const raw = match ? match[1].trim() : "";
    out.bezorgtijdVoorkeur = raw || def.bezorgtijdVoorkeur;
    if (out.bezorgtijdVoorkeur.toLowerCase().includes("tussen") && !out.bezorgtijdVoorkeur.includes(":")) {
      out.bezorgtijdVoorkeur = out.bezorgtijdVoorkeur.replace(/(\d{1,2})\s*en\s*(\d{1,2})/i, "$1:00 - $2:00");
    }
  }
  if (lower.includes("datum")) {
    const match = text.match(/(?:datum|Datum)\s*[:\-]?\s*([^\n]+)/i);
    out.datumOpmerking = match ? match[1].trim() : def.datumOpmerking;
  }
  if (lower.includes("opmerking")) {
    const match = text.match(/(?:opmerking|Opmerking)\s*[:\-]?\s*([^\n]+)/i);
    out.opmerkingenKlant = match ? match[1].trim() : def.opmerkingenKlant;
  }

  return out;
}

function getShippingOrBilling<T>(order: ShopifyOrder, field: keyof ShopifyAddress): string {
  const s = order.shipping_address?.[field];
  const b = order.billing_address?.[field];
  return ifempty(s, b) || "";
}

function getPhone(order: ShopifyOrder): string {
  return ifempty(
    order.shipping_address?.phone,
    order.customer?.phone,
    order.billing_address?.phone,
    order.phone,
    "geen nummer"
  );
}

function getEmail(order: ShopifyOrder): string {
  return ifempty(order.customer?.email, order.email, order.contact_email, "geen email");
}

function getVolledigAdres(order: ShopifyOrder): string {
  const parts = [
    getShippingOrBilling(order, "address1"),
    getShippingOrBilling(order, "address2"),
    getShippingOrBilling(order, "zip"),
    getShippingOrBilling(order, "city"),
  ].filter(Boolean);
  return parts.join(", ");
}

function buildAdresUrl(volledigAdres: string): string {
  if (!volledigAdres) return "";
  const q = encodeURIComponent(volledigAdres);
  return `https://maps.google.com/maps?q=${q}`;
}

function buildBelLink(phone: string, firstName: string): string {
  const e164 = phoneToE164(phone);
  if (!e164 || phone === "geen nummer") return "";
  const label = encodeURIComponent(`Bel ${firstName || "klant"}`);
  return `https://call.ctrlq.org/${e164};${label}`;
}

function getAantalFietsen(order: ShopifyOrder): number {
  const tags = (order.tags ?? "").toLowerCase();
  const lineItems = order.line_items ?? [];
  const isReparatieType =
    tags.includes("terugbrengen") ||
    tags.includes("ophalen") ||
    tags.includes("reparatie aan huis") ||
    tags.includes("proefrit");

  if (isReparatieType) return lineItems.length;
  const priceLimit = 500;
  return lineItems.filter((item) => {
    const p = typeof item.price === "string" ? parseFloat(item.price) : Number(item.price ?? 0);
    return p > priceLimit;
  }).length;
}

function getProducten(order: ShopifyOrder): string {
  const items = order.line_items ?? [];
  return items.map((i) => i.name ?? "").filter(Boolean).join("\n");
}

const PRICE_LIMIT_FIETS = 500;
const EXCLUDE_PROPERTY_NAME = "_Personalize";

export interface LineItemForJson {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
}

/** Bouw een JSON-string van alle line items met naam, prijs en montage-properties (voor fietsen). */
export function buildLineItemsJson(order: ShopifyOrder): string | null {
  const items = order.line_items ?? [];
  if (!items.length) return null;

  const structured: LineItemForJson[] = items.map((item) => {
    const price =
      typeof item.price === "string"
        ? parseFloat(item.price)
        : Number(item.price ?? 0);
    const isFiets = price > PRICE_LIMIT_FIETS;

    const properties = isFiets
      ? (item.properties ?? [])
          .filter(
            (p) =>
              p.name &&
              p.name !== EXCLUDE_PROPERTY_NAME &&
              p.value != null &&
              String(p.value).trim() !== ""
          )
          .map((p) => ({ name: p.name!, value: String(p.value!) }))
      : [];

    return { name: item.name ?? "", price, isFiets, properties };
  });

  // Fietsen eerst, daarna accessoires
  structured.sort((a, b) => Number(b.isFiets) - Number(a.isFiets));

  return JSON.stringify(structured);
}

/** Datum uit created_at (YYYY-MM-DD) */
function getDatum(order: ShopifyOrder): string | null {
  const created = order.created_at;
  if (!created) return null;
  try {
    const d = new Date(created);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/** Betaald: paid → true, anders false. We tonen later 'betaald' / 'factuur betaling aan deur'. */
function getBetaald(order: ShopifyOrder): boolean {
  return (order.financial_status ?? "").toLowerCase() === "paid";
}

export interface RitjesOrderRow {
  source: "shopify";
  type: "verkoop" | "reparatie_ophalen" | "reparatie_terugbrengen" | "reparatie_deur" | "mp_winkel";
  status: "ritjes_vandaag";
  order_nummer: string | null;
  naam: string | null;
  adres_url: string | null;
  bel_link: string | null;
  bezorgtijd_voorkeur: string | null;
  meenemen_in_planning: boolean;
  nieuw_appje_sturen: boolean;
  datum_opmerking: string | null;
  opmerkingen_klant: string | null;
  producten: string | null;
  bestelling_totaal_prijs: number | null;
  betaald: boolean | null;
  volledig_adres: string | null;
  telefoon_nummer: string | null;
  order_id: string | null;
  datum: string | null;
  aantal_fietsen: number | null;
  email: string | null;
  telefoon_e164: string | null;
  model: string | null;
  serienummer: string | null;
  mp_tags: string | null;
  line_items_json: string | null;
}

/** Bepaal type uit tags */
function getOrderType(order: ShopifyOrder): RitjesOrderRow["type"] {
  const tags = (order.tags ?? "").toLowerCase();
  if (tags.includes("ophalen")) return "reparatie_ophalen";
  if (tags.includes("terugbrengen")) return "reparatie_terugbrengen";
  if (tags.includes("reparatie aan huis")) return "reparatie_deur";
  if (tags.includes("proefrit")) return "verkoop";
  return "verkoop";
}

/** Zet een Shopify-order om naar één rij voor Ritjes voor vandaag (orders-tabel). */
export function mapShopifyOrderToRitjesRow(order: ShopifyOrder): RitjesOrderRow {
  const noteParsed = parseNote(order.note);
  const volledigAdres = getVolledigAdres(order);
  const telefoon = getPhone(order);
  const firstName = order.customer?.first_name ?? "";

  return {
    source: "shopify",
    type: getOrderType(order),
    status: "ritjes_vandaag",
    order_nummer: order.name ?? null,
    naam: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || null,
    adres_url: buildAdresUrl(volledigAdres) || null,
    bel_link: buildBelLink(telefoon, firstName) || null,
    bezorgtijd_voorkeur: noteParsed.bezorgtijdVoorkeur || null,
    meenemen_in_planning: true,
    nieuw_appje_sturen: true,
    datum_opmerking: noteParsed.datumOpmerking || null,
    opmerkingen_klant: noteParsed.opmerkingenKlant || null,
    producten: getProducten(order) || null,
    bestelling_totaal_prijs: totalPriceNumber(order),
    betaald: getBetaald(order),
    volledig_adres: volledigAdres || null,
    telefoon_nummer: telefoon !== "geen nummer" ? telefoon : null,
    order_id: order.id != null ? String(order.id) : null,
    datum: getDatum(order),
    aantal_fietsen: getAantalFietsen(order) || null,
    email: getEmail(order) !== "geen email" ? getEmail(order) : null,
    telefoon_e164: telefoon !== "geen nummer" ? phoneToE164(telefoon) : null,
    model: null,
    serienummer: null,
    mp_tags: null,
    line_items_json: buildLineItemsJson(order),
  };
}

function totalPriceNumber(order: ShopifyOrder): number | null {
  const p = order.total_price;
  if (p == null) return null;
  const n = typeof p === "string" ? parseFloat(p) : Number(p);
  return isNaN(n) ? null : n;
}
