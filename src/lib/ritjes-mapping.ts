/**
 * Mapping tussen Ritjes voor vandaag tabelkolommen en order-velden (API/supabase).
 */

export const RITJES_HEADERS = [
  "Order Nummer",
  "Naam",
  "Adress URL",
  "Bel link",
  "Aankomsttijd (HH:MM - HH:MM)",
  "Bezorgtijd voorkeur (opmerkingen van Sjoerd)",
  "Meenemen in planning (anders veranderen naar nee)",
  "Nieuw appje sturen?",
  "Datum opmerking",
  "Opmerkingen klant",
  "Product(en)",
  "Bestelling Totaal Prijs",
  "Betaald?",
  "Volledig adress",
  "Ingevuld Telefoon nummer",
  "Order ID",
  "Datum",
  "Aantal fietsen",
  "Email",
  "Nummer in E.164 formaat",
  "Model",
  "Serienummer",
  "MP tags",
] as const;

export const RITJES_HEADER_TO_FIELD: Record<string, string> = {
  "Order Nummer": "order_nummer",
  "Naam": "naam",
  "Adress URL": "adres_url",
  "Bel link": "bel_link",
  "Aankomsttijd (HH:MM - HH:MM)": "aankomsttijd_slot",
  "Bezorgtijd voorkeur (opmerkingen van Sjoerd)": "bezorgtijd_voorkeur",
  "Meenemen in planning (anders veranderen naar nee)": "meenemen_in_planning",
  "Nieuw appje sturen?": "nieuw_appje_sturen",
  "Datum opmerking": "datum_opmerking",
  "Opmerkingen klant": "opmerkingen_klant",
  "Product(en)": "producten",
  "Bestelling Totaal Prijs": "bestelling_totaal_prijs",
  "Betaald?": "betaald",
  "Volledig adress": "volledig_adres",
  "Ingevuld Telefoon nummer": "telefoon_nummer",
  "Order ID": "order_id",
  "Datum": "datum",
  "Aantal fietsen": "aantal_fietsen",
  "Email": "email",
  "Nummer in E.164 formaat": "telefoon_e164",
  "Model": "model",
  "Serienummer": "serienummer",
  "MP tags": "mp_tags",
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

/** Boolean-kolommen in de ritjes-tabel */
const RITJES_BOOLEAN_FIELDS = new Set([
  "meenemen_in_planning",
  "nieuw_appje_sturen",
  "betaald",
]);

/** Numeric-kolommen */
const RITJES_NUMERIC_FIELDS = new Set([
  "bestelling_totaal_prijs",
  "aantal_fietsen",
]);

/**
 * Bepaalt welk veld en welke waarde er naar de API moeten voor een cel-edit.
 * Voor "Betaald?": "ja"/"nee" → betaald (boolean), anders → betaalmethode (string).
 */
export function ritjesCellToPayload(
  header: string,
  value: string
): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (header === "Betaald?") {
    const lower = trimmed.toLowerCase();
    if (lower === "ja") return { betaald: true, betaalmethode: null };
    if (lower === "nee") return { betaald: false, betaalmethode: null };
    return { betaalmethode: trimmed || null };
  }
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
    const num = field === "aantal_fietsen" ? parseInt(trimmed, 10) : parseFloat(trimmed.replace(",", "."));
    if (Number.isNaN(num)) return null;
    return { [field]: num };
  }
  return { [field]: trimmed || null };
}

export function ordersToTableRows(orders: RitjesOrderFromApi[]): string[][] {
  return orders.map((o) =>
    RITJES_HEADERS.map((h) => {
      // Betaald?: toon betaalmethode (bijv. "contant aan deur") als die er is, anders ja/nee
      if (h === "Betaald?") {
        const methode = o.betaalmethode as string | null | undefined;
        if (methode != null && String(methode).trim() !== "") return String(methode).trim();
        const v = o.betaald;
        if (v === null || v === undefined) return "";
        return typeof v === "boolean" ? (v ? "ja" : "nee") : String(v);
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
