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

export interface ShopifyShippingLine {
  title?: string | null;
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
  shipping_lines?: ShopifyShippingLine[] | null;
}

const SHIPPING_EXCLUDE_TITLE = "koopjefatbike showroom";

/** Order komt alleen in Ritjes voor vandaag als hij door dit filter gaat */
export function passesRitjesFilter(order: ShopifyOrder): boolean {
  // Uitsluiten: shipping line title is (case insensitive) "koopjefatbike showroom"
  const shippingLines = order.shipping_lines ?? [];
  const isShowroom = shippingLines.some(
    (line) =>
      (line.title ?? "").trim().toLowerCase() === SHIPPING_EXCLUDE_TITLE.toLowerCase()
  );
  if (isShowroom) return false;

  const totalPrice = parseFloat(String(order.total_price ?? 0));
  const tags = (order.tags ?? "").toLowerCase();

  const hasTerugbrengen = tags.includes("terugbrengen");
  const hasOphalen = tags.includes("ophalen");
  const hasReparatieAanHuis = tags.includes("reparatie aan huis");
  const hasProefrit = tags.includes("proefrit");

  if (hasTerugbrengen || hasOphalen || hasReparatieAanHuis || hasProefrit) return true;
  if (totalPrice > 500) return true;
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

  const out = { ...def };

  {
    // Alleen als er echt een regel begint met "Tijd"
    // Maar sommige Shopify notes gebruiken "Bezorgtijd voorkeur" of "Bezorgtijd".
    const match = text.match(
      /^\s*(?:bezorgtijd\s*voorkeur|bezorgtijd|tijd)\s*[:\-]?\s*([^\n]+)/im
    );
    const raw = match ? match[1].trim() : "";
    if (raw) {
      out.bezorgtijdVoorkeur = raw;
      if (out.bezorgtijdVoorkeur.toLowerCase().includes("tussen") && !out.bezorgtijdVoorkeur.includes(":")) {
        out.bezorgtijdVoorkeur = out.bezorgtijdVoorkeur.replace(
          /(\d{1,2})\s*en\s*(\d{1,2})/i,
          "$1:00 - $2:00"
        );
      }
    }
  }
  {
    // Alleen als er echt een regel begint met "Datum" (niet "Geboortedatum")
    const match = text.match(/^\s*datum\s*[:\-]?\s*([^\n]+)/im);
    if (match) out.datumOpmerking = match[1].trim() || def.datumOpmerking;
  }
  {
    // Alleen als er echt een regel begint met "Opmerking"
    const match = text.match(/^\s*opmerking\s*[:\-]?\s*([^\n]+)/im);
    if (match) out.opmerkingenKlant = match[1].trim() || def.opmerkingenKlant;
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

/**
 * Splits een producttitel op '&' om meerdere fietsen te herkennen.
 * "V20 PRO & V8 PRO + kettingslot" → ["V20 PRO", "V8 PRO + kettingslot"]
 */
function splitBikesOnAmpersand(title: string): string[] {
  return title.split("&").map((s) => s.trim()).filter(Boolean);
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
  return lineItems
    .filter((item) => {
      const p = typeof item.price === "string" ? parseFloat(item.price) : Number(item.price ?? 0);
      return p > priceLimit;
    })
    .reduce((sum, item) => {
      // Elke '&' in de titel is een extra fiets
      const bikeCount = splitBikesOnAmpersand(item.name ?? "").length || 1;
      return sum + bikeCount;
    }, 0);
}

function getProducten(order: ShopifyOrder): string {
  const items = order.line_items ?? [];
  const names: string[] = [];
  for (const item of items) {
    const name = (item.name ?? "").trim();
    if (!name) continue;
    if (name.includes("&")) {
      // Elke fiets na '&' als aparte regel tonen
      names.push(...splitBikesOnAmpersand(name));
    } else {
      names.push(name);
    }
  }
  return names.join("\n");
}

const PRICE_LIMIT_FIETS = 500;
const EXCLUDE_PROPERTY_NAME = "_Personalize";

export interface LineItemForJson {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
  /** Standaard inbegrepen producten die altijd bij deze fiets worden meegeleverd */
  defaultItems: string[];
}

function looksLikeMontageTekst(s: string): boolean {
  const t = s.toLowerCase();
  return (
    t.includes("montage") ||
    t.includes("monteren") ||
    t.includes("gemonteerd") ||
    t.includes("gemonteerde") ||
    t.includes("gemont") // vangt 'gemonteer...' varianten
  );
}

function expandQtyFromPrefix(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  const m = s.match(/^(\d+)\s*x\s*(.+)$/i);
  if (!m) return [s];
  const qty = Math.max(1, Math.min(50, parseInt(m[1], 10) || 1));
  const name = (m[2] ?? "").trim();
  if (!name) return [s];
  return Array.from({ length: qty }, () => name);
}

function shouldIgnoreExtraProductName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  // Deze zijn geen losse producten voor paklijst/afronden; het zijn levering/montage labels
  if (n === "volledig rijklaar") return true;
  if (n === "rijklaar") return true;
  if (n === "in doos") return true;
  return false;
}

/**
 * Handmatig aangemaakte Shopify orders hebben vaak geen properties.
 * In dat geval staan extra's in de producttitel: '... rijklaar + kettingslot + voorrekje gemonteerd'
 * - Extra's → losse non-fiets items
 * - Montage-achtige tekst → property onder de fiets
 */
function parseExtrasFromManualBikeTitle(title: string): {
  baseName: string;
  extraItems: string[];
  montageProperties: { name: string; value: string }[];
} {
  const parts = String(title ?? "")
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return { baseName: String(title ?? "").trim(), extraItems: [], montageProperties: [] };
  }

  const baseName = parts[0];
  const extras = parts.slice(1);

  const montageBits: string[] = [];
  const extraItems: string[] = [];

  for (const e of extras) {
    if (looksLikeMontageTekst(e)) {
      montageBits.push(e);
      continue;
    }
    for (const expanded of expandQtyFromPrefix(e)) {
      const trimmed = expanded.trim();
      if (!trimmed) continue;
      if (shouldIgnoreExtraProductName(trimmed)) continue;
      extraItems.push(trimmed);
    }
  }

  const montageProperties =
    montageBits.length > 0
      ? [{ name: "Montage", value: montageBits.join(" + ") }]
      : [];

  return { baseName, extraItems, montageProperties };
}

/**
 * Haalt het korte modelnaam op uit een productnaam.
 * 'V20 PRO Fatbike 2026 + ringslot | Combi-Deal 🔥' → 'V20 PRO'
 */
export function extractModelnaamVanProduct(naam: string): string {
  const match = naam.match(/^(.+?)\s+fatbike/i);
  if (match) return match[1].trim();
  // Fallback: eerste twee woorden
  const words = naam.trim().split(/\s+/);
  return words.slice(0, 2).join(" ");
}

/** Normaliseert een Levering-waarde: trim + verwijder afsluitende dubbele punt + lowercase. */
function normaliseerLevering(v: string): string {
  return v.trim().replace(/:$/, "").trim().toLowerCase();
}

/** Case-insensitieve vergelijking van modelnaam tegen een lijst van doelmodellen. */
function matchesModels(model: string, targets: string[]): boolean {
  const ml = model.toLowerCase().trim();
  return targets.some((t) => t.toLowerCase().trim() === ml);
}

/**
 * Geeft de standaard inbegrepen producten voor een fiets,
 * op basis van modelnaam én de Levering-property uit Shopify.
 *
 * Altijd (elke fiets > €500):
 *   - Fietspompje
 *   - Opladerdoosje {model}
 *
 * Afhankelijk van Levering-waarde + model: zie implementatie.
 */
function getDefaultItemsVoorFiets(
  naam: string,
  rawProperties: ShopifyLineItemProperty[]
): string[] {
  const model = extractModelnaamVanProduct(naam);
  const naamLower = naam.toLowerCase();

  const items: string[] = ["Fietspompje", `Opladerdoosje ${model}`];

  const isEngweOfAdo =
    naamLower.includes("engwe") || naamLower.includes("ado");

  const leveringRaw =
    rawProperties.find((p) => p.name?.toLowerCase().trim() === "levering")
      ?.value ?? "";
  const levering = normaliseerLevering(leveringRaw);

  if (levering === "volledig rijklaar") {
    // Alle fietsen behalve Engwe/Ado
    if (!isEngweOfAdo) {
      items.push("ART-2 kettingslot", "telefoontasje");
    }

    // V8 MAX ultra + V8 ultra
    if (matchesModels(model, ["V8 MAX ultra", "V8 ultra"])) {
      items.push("goedkope spiegel links");
    }

    // Voorrekje-modellen
    if (
      matchesModels(model, [
        "V20 Limited", "GT20", "V8 ultra mini", "V8 MAX ultra", "V8 ultra",
        "V8 PRO", "V8 PRO MAX", "Q8", "S20 PRO", "H9", "V20 PRO comfort",
      ])
    ) {
      items.push("voorrekje");
    }
  } else if (levering === "in doos") {
    // Alle fietsen behalve Engwe/Ado
    if (!isEngweOfAdo) {
      items.push("ART-2 kettingslot");
    }

    // Accu-modellen
    if (
      matchesModels(model, [
        "V20 Pro", "V20 Limited", "S20 Pro", "V20 mini", "V20 Pro Comfort",
      ])
    ) {
      items.push("accu");
    }

    // Display + losse oplader
    if (
      matchesModels(model, [
        "V20 Pro", "V20 Pro comfort", "V20 Limited", "S20 Pro",
      ])
    ) {
      items.push("display", "losse oplader");
    }
  }

  return items;
}

/** Bouw een JSON-string van alle line items met naam, prijs en montage-properties (voor fietsen). */
export function buildLineItemsJson(order: ShopifyOrder): string | null {
  const items = order.line_items ?? [];
  if (!items.length) return null;

  const structured: LineItemForJson[] = [];

  for (const item of items) {
    const price =
      typeof item.price === "string"
        ? parseFloat(item.price)
        : Number(item.price ?? 0);
    const isFiets = price > PRICE_LIMIT_FIETS;
    const rawName = (item.name ?? "").trim();
    const rawProps = item.properties ?? [];
    const hasProps = rawProps.length > 0;

    // ── '&' in de titel → meerdere fietsen in één line item ──────────────
    if (isFiets && rawName.includes("&")) {
      const bikeTitles = splitBikesOnAmpersand(rawName);
      const pricePerBike = price / Math.max(1, bikeTitles.length);

      for (const bikeTitle of bikeTitles) {
        const parsed = parseExtrasFromManualBikeTitle(bikeTitle);
        const defaultItems = getDefaultItemsVoorFiets(parsed.baseName, []);

        structured.push({
          name: parsed.baseName,
          price: pricePerBike,
          isFiets: true,
          properties: parsed.montageProperties,
          defaultItems,
        });

        for (const extra of parsed.extraItems) {
          structured.push({
            name: extra,
            price: 0,
            isFiets: false,
            properties: [],
            defaultItems: [],
          });
        }
      }
      continue;
    }

    // ── Handmatige order zonder properties ('+' in titel) ─────────────────
    if (isFiets && !hasProps) {
      const parsed = parseExtrasFromManualBikeTitle(rawName);
      const defaultItems = getDefaultItemsVoorFiets(parsed.baseName, rawProps);

      structured.push({
        name: parsed.baseName,
        price,
        isFiets: true,
        properties: parsed.montageProperties,
        defaultItems,
      });

      for (const extra of parsed.extraItems) {
        structured.push({
          name: extra,
          price: 0,
          isFiets: false,
          properties: [],
          defaultItems: [],
        });
      }

      continue;
    }

    // ── Reguliere Shopify order met properties ────────────────────────────
    const properties = isFiets
      ? rawProps
          .filter(
            (p) =>
              p.name &&
              p.name !== EXCLUDE_PROPERTY_NAME &&
              p.value != null &&
              String(p.value).trim() !== ""
          )
          .map((p) => ({ name: p.name!, value: String(p.value!) }))
      : [];

    const defaultItems = isFiets
      ? getDefaultItemsVoorFiets(rawName, rawProps)
      : [];

    structured.push({
      name: rawName,
      price,
      isFiets,
      properties,
      defaultItems,
    });
  }

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

/**
 * Zet Shopify order.tags om naar een leesbare MP-tag-string.
 * Doel: de `tag` kolom op "Ritjes vandaag" vullen.
 */
function getMpTagFromShopifyOrderTags(order: ShopifyOrder): string | null {
  // Shopify tags komen als comma-separated string.
  // We willen deze tags 1-op-1 terugzien in de 'tag' kolom.
  const raw = String(order.tags ?? "").trim();
  if (!raw) return "geen tag";

  const tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(tags));
  return uniq.length ? uniq.join(", ") : "geen tag";
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
    mp_tags: getMpTagFromShopifyOrderTags(order),
    line_items_json: buildLineItemsJson(order),
  };
}

function totalPriceNumber(order: ShopifyOrder): number | null {
  const p = order.total_price;
  if (p == null) return null;
  const n = typeof p === "string" ? parseFloat(p) : Number(p);
  return isNaN(n) ? null : n;
}
