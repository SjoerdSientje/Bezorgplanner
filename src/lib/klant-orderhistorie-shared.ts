/** Client-veilige types/helpers voor klant-ordergeschiedenis. */

export type KlantOrderHistorieSamenvatting = {
  id: string;
  /** DD-MM-JJJJ UU:mm of null als onbekend. */
  aangemaaktOp: string | null;
  typeLabel: string;
  totaalPrijs: number | null;
};

export type KlantOrderHistorieProduct = {
  naam: string;
  prijs: number | null;
};

export type KlantOrderHistorieDetail = KlantOrderHistorieSamenvatting & {
  source: string | null;
  orderNummer: string | null;
  opmerking: string | null;
  /** DD-MM-JJJJ UU:mm of null. */
  afgerondOp: string | null;
  /** Bezorgernaam, of "Afgehaald" bij winkelafhaal. */
  bezorger: string | null;
  /** Alleen MP/reparatie: wie de order aanmaakte. */
  aangemaaktDoor: string | null;
  /** Alleen reparatie: uitgebreid verhaal. */
  achtergrondverhaal: string | null;
  producten: KlantOrderHistorieProduct[];
  linkFactuur: string | null;
  linkAankoopbewijs: string | null;
};

/** Weergave bezorger: afhaal → "Afgehaald", anders bezorgernaam. */
export function formatKlantOrderBezorger(input: {
  type?: string | null;
  bezorgerNaam?: string | null;
  orderNummer?: string | null;
}): string | null {
  const type = String(input.type ?? "").trim().toLowerCase();
  const bezorger = String(input.bezorgerNaam ?? "").trim();
  const orderNummer = String(input.orderNummer ?? "").trim();

  if (
    type === "mp_winkel" ||
    bezorger.toLowerCase() === "winkelverkoop" ||
    /^#?afh/i.test(orderNummer)
  ) {
    return "Afgehaald";
  }
  return bezorger || null;
}

export function formatKlantOrderDateTime(
  iso: string | null | undefined
): string | null {
  const raw = String(iso ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  if (!day || !month || !year) return null;
  return `${day}-${month}-${year} ${hour}:${minute}`;
}

export function formatKlantOrderPrijs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `€ ${value.toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Korte productregel voor de ordergeschiedenis-lijst (zonder detailklik). */
export function formatKlantOrderProductenLijst(
  producten: KlantOrderHistorieProduct[] | null | undefined,
  maxItems = 4
): string | null {
  const names = (producten ?? [])
    .map((p) => String(p?.naam ?? "").trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  const shown = names.slice(0, Math.max(1, maxItems));
  const extra = names.length - shown.length;
  const text = shown.join(" · ");
  return extra > 0 ? `${text} · +${extra}` : text;
}

/** Leesbare order-types voor de geschiedenislijst. */
export function klantOrderTypeLabel(input: {
  source?: string | null;
  type?: string | null;
}): string {
  const source = String(input.source ?? "").trim().toLowerCase();
  const type = String(input.type ?? "").trim().toLowerCase();

  if (source === "shopify") return "Shopify order";
  if (source === "mp") {
    if (type === "mp_winkel") return "MP afhaal order";
    return "MP bezorg order";
  }
  if (source === "reparatie") {
    if (type === "reparatie_ophalen") return "Ophalen";
    if (type === "reparatie_terugbrengen") return "Terugbrengen";
    if (type === "reparatie_deur") return "Reparatie aan huis";
    return "Reparatie";
  }
  if (type) return type;
  if (source) return source;
  return "Order";
}
