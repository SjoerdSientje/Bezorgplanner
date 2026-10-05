/**
 * Mapping tussen Ritjes voor vandaag tabelkolommen en order-velden (API/supabase).
 */

import { comparePlanningDatumKeys } from "@/lib/planning-date";

export const RITJES_HEADERS = [
  "Order Nummer",
  "Naam",
  "Adress URL",
  "Bel link",
  "Aankomsttijd (HH:MM - HH:MM)",
  "Bezorgtijd voorkeur (opmerkingen van Sjoerd)",
  "Meenemen in planning (anders veranderen naar nee)",
  "Datum opmerking",
  "Opmerkingen klant",
  "Product(en)",
  "Bestelling Totaal Prijs",
  "Al betaald",
  "Te betalen",
  "Volledig adress",
  "Ingevuld Telefoon nummer",
  "Order ID",
  "Datum",
  "Aantal fietsen",
  "Email",
  "Nummer in E.164 formaat",
  "Model",
  "tag",
] as const;

export const RITJES_HEADER_TO_FIELD: Record<string, string> = {
  "Order Nummer": "order_nummer",
  "Naam": "naam",
  "Adress URL": "adres_url",
  "Bel link": "bel_link",
  "Aankomsttijd (HH:MM - HH:MM)": "aankomsttijd_slot",
  "Bezorgtijd voorkeur (opmerkingen van Sjoerd)": "bezorgtijd_voorkeur",
  "Meenemen in planning (anders veranderen naar nee)": "meenemen_in_planning",
  "Datum opmerking": "datum_opmerking",
  "Opmerkingen klant": "opmerkingen_klant",
  "Product(en)": "producten",
  "Bestelling Totaal Prijs": "bestelling_totaal_prijs",
  "Al betaald": "al_betaald",
  "Te betalen": "te_betalen",
  "Volledig adress": "volledig_adres",
  "Ingevuld Telefoon nummer": "telefoon_nummer",
  "Order ID": "order_id",
  "Datum": "datum",
  "Aantal fietsen": "aantal_fietsen",
  "Email": "email",
  "Nummer in E.164 formaat": "telefoon_e164",
  "Model": "model",
  "tag": "mp_tags",
};

export type RitjesOrderFromApi = Record<string, unknown>;

/**
 * Ritjes voor vandaag: nieuwste order bovenaan (created_at aflopend).
 * Gebruik na elke fetch (incl. Verversen) zodat de volgorde altijd klopt.
 */
export function sortRitjesOrdersNewestFirst<T extends RitjesOrderFromApi>(orders: T[]): T[] {
  const parseOrderNum = (value: unknown): number => {
    const s = String(value ?? "").trim();
    const m = s.match(/\d+/g);
    if (!m || m.length === 0) return 0;
    const n = parseInt(m.join(""), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const parseTime = (value: unknown): number => {
    if (!value) return 0;
    const t = new Date(String(value)).getTime();
    return Number.isFinite(t) ? t : 0;
  };

  return [...orders].sort((a, b) => {
    const tb = parseTime(b.created_at);
    const ta = parseTime(a.created_at);
    if (tb !== ta) return tb - ta;

    // Fallback for rows with missing/equal created_at: highest order number first.
    const nb = parseOrderNum(b.order_nummer);
    const na = parseOrderNum(a.order_nummer);
    if (nb !== na) return nb - na;

    const ub = parseTime(b.updated_at);
    const ua = parseTime(a.updated_at);
    return ub - ua;
  });
}

/**
 * Tab Routes: vandaag-lopende planning eerst, daarna morgen; binnen groep op aankomsttijd.
 */
export function sortRoutesTabOrders<T extends RitjesOrderFromApi>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const da = String(a.planning_slot_datum ?? "9999-99-99");
    const db = String(b.planning_slot_datum ?? "9999-99-99");
    const dateCmp = comparePlanningDatumKeys(da, db);
    if (dateCmp !== 0) return dateCmp;
    // Binnen dezelfde datum: groeperen op route_nummer (0 = geen route → achteraan)
    const ra = Number((a as Record<string, unknown>).route_nummer ?? 0);
    const rb = Number((b as Record<string, unknown>).route_nummer ?? 0);
    const routeA = ra > 0 ? ra : 999;
    const routeB = rb > 0 ? rb : 999;
    if (routeA !== routeB) return routeA - routeB;
    return compareOrdersOnRoute(a, b);
  });
}

/** Sorteer orders binnen dezelfde route: eerst stopvolgorde (rit_nummer), anders tijdslot. */
export function compareOrdersOnRoute(
  a: RitjesOrderFromApi,
  b: RitjesOrderFromApi
): number {
  const parseSlotMin = (value: unknown): number => {
    const t = String(value ?? "").split(" - ")[0].replace(".", ":").trim();
    const [h, m] = t.split(":").map((x) => parseInt(x, 10));
    if (!Number.isFinite(h)) return 9999;
    let mins = h * 60 + (Number.isFinite(m) ? m : 0);
    // Stops die over middernacht heen zijn gewikkeld (00:00–05:59) horen NA de avond,
    // niet vóór de ochtend — anders belandt de laatste stop bovenaan de lijst.
    if (h >= 0 && h < 6) mins += 24 * 60;
    return mins;
  };

  const ra = Number((a as Record<string, unknown>).rit_nummer ?? 0);
  const rb = Number((b as Record<string, unknown>).rit_nummer ?? 0);
  const hasRa = ra > 0;
  const hasRb = rb > 0;
  if (hasRa && hasRb && ra !== rb) return ra - rb;
  if (hasRa !== hasRb) return hasRa ? -1 : 1;
  return parseSlotMin(a.aankomsttijd_slot) - parseSlotMin(b.aankomsttijd_slot);
}

/** Boolean-kolommen in de ritjes-tabel */
const RITJES_BOOLEAN_FIELDS = new Set([
  "meenemen_in_planning",
]);

/** Numeric-kolommen */
const RITJES_NUMERIC_FIELDS = new Set([
  "bestelling_totaal_prijs",
  "al_betaald",
  "te_betalen",
  "aantal_fietsen",
]);

/**
 * Bepaalt welk veld en welke waarde er naar de API moeten voor een cel-edit.
 */
export function ritjesCellToPayload(
  header: string,
  value: string
): Record<string, unknown> | null {
  const trimmed = value.trim();
  const field = RITJES_HEADER_TO_FIELD[header];
  if (!field) return null;
  if (RITJES_BOOLEAN_FIELDS.has(field)) {
    const lower = trimmed.toLowerCase();
    if (lower === "ja") return { [field]: true };
    if (lower === "nee") return { [field]: false };
    return { [field]: null };
  }
  if (RITJES_NUMERIC_FIELDS.has(field)) {
    if (trimmed === "") return { [field]: null };
    const num =
      field === "aantal_fietsen"
        ? parseInt(trimmed, 10)
        : parseFloat(trimmed.replace(",", "."));
    if (Number.isNaN(num)) return null;
    const payload: Record<string, unknown> = { [field]: num };
    // Houd boolean betaald in sync bij handmatige override van te_betalen.
    if (field === "te_betalen") {
      payload.betaald = num < 0.01;
    }
    return payload;
  }
  return { [field]: trimmed || null };
}

export function ordersToTableRows(orders: RitjesOrderFromApi[]): string[][] {
  const formatMoney = (v: unknown): string => {
    if (v == null || v === "") return "";
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    if (!Number.isFinite(n)) return "";
    return String(Math.round(n * 100) / 100);
  };

  return orders.map((o) =>
    RITJES_HEADERS.map((h) => {
      if (h === "Al betaald") return formatMoney((o as any)?.al_betaald);
      if (h === "Te betalen") return formatMoney((o as any)?.te_betalen);

      if (h === "tag") {
        const v = (o as any)?.mp_tags;
        const s = v == null ? "" : String(v).trim();
        return s ? s : "geen tag";
      }

      const key = RITJES_HEADER_TO_FIELD[h];
      const v = key ? o[key] : undefined;
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? "ja" : "nee";
      if (typeof v === "number") return String(v);
      return String(v);
    })
  );
}
