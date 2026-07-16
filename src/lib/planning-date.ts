/**
 * Bepalen van de planningdatum: vóór rollover = vandaag, vanaf rollover = morgen.
 * Tijdzone: Europe/Amsterdam.
 *
 * Let op: gebruik overal dezelfde drempel ({@link PLANNING_ROLLOVER_HOUR_AMSTERDAM}) —
 * route genereren, planning goedkeuren en “stuur appjes”-doeldatum moeten hetzelfde
 * “vandaag/morgen”-begrip hebben.
 */
export const PLANNING_ROLLOVER_HOUR_AMSTERDAM = 18;

/**
 * @param cutoffHour Uur (0-23) waarop overgegaan wordt naar morgen; standaard = {@link PLANNING_ROLLOVER_HOUR_AMSTERDAM}.
 */
export function getPlanningDate(cutoffHour: number = PLANNING_ROLLOVER_HOUR_AMSTERDAM): { date: string; isTomorrow: boolean } {
  const now = new Date();
  const amsterdam = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const hour = amsterdam.getHours();
  const minute = amsterdam.getMinutes();
  const totalMinutes = hour * 60 + minute;
  const cutoff = cutoffHour * 60;

  if (totalMinutes >= cutoff) {
    amsterdam.setDate(amsterdam.getDate() + 1);
  }
  const y = amsterdam.getFullYear();
  const m = String(amsterdam.getMonth() + 1).padStart(2, "0");
  const d = String(amsterdam.getDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    isTomorrow: totalMinutes >= cutoff,
  };
}

/** Zelfde rollover als route/ritjes ({@link PLANNING_ROLLOVER_HOUR_AMSTERDAM}). */
export function getPlanningDateForGoedkeuren() {
  return getPlanningDate(PLANNING_ROLLOVER_HOUR_AMSTERDAM);
}

/** Kalenderdatum Amsterdam als YYYY-MM-DD; offsetDays verschuiving (0 = vandaag). */
export function getAmsterdamCalendarDate(offsetDays = 0): string {
  const now = new Date();
  const amsterdam = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  amsterdam.setDate(amsterdam.getDate() + offsetDays);
  const y = amsterdam.getFullYear();
  const m = String(amsterdam.getMonth() + 1).padStart(2, "0");
  const d = String(amsterdam.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * UTC-grenzen (ISO) van een Amsterdam-kalenderdag, geschikt om te vergelijken met
 * `timestamptz`-kolommen (bv. `created_at`). `end` is exclusief.
 * Nodig omdat een naïeve `"YYYY-MM-DDT00:00:00"`-string door Postgres als UTC
 * wordt geïnterpreteerd, niet als Amsterdam-tijd (scheelt 1-2 uur door CET/CEST).
 */
export function getAmsterdamDayUtcRange(dateStr: string): { startUtcIso: string; endUtcIsoExclusive: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = amsterdamMidnightToUtc(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  const end = amsterdamMidnightToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { startUtcIso: start.toISOString(), endUtcIsoExclusive: end.toISOString() };
}

function amsterdamMidnightToUtc(year: number, month: number, day: number): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = amsterdamOffsetMinutes(utcGuess);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function amsterdamOffsetMinutes(atUtc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Amsterdam",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(atUtc);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUtc - atUtc.getTime()) / 60_000;
}

/**
 * Sorteer planning-datums: vandaag eerst, daarna toekomst oplopend, verleden als laatste.
 */
export function comparePlanningDatumKeys(a: string, b: string): number {
  const today = getAmsterdamCalendarDate(0);
  const tier = (d: string) => {
    if (!d || d === "9999-99-99" || d === "onbekend") return 3;
    if (d === today) return 0;
    if (d > today) return 1;
    return 2;
  };
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;
  return a.localeCompare(b);
}

export function planningDatumGroupLabel(datum: string): {
  text: string;
  isToday: boolean;
  isTomorrow: boolean;
} {
  const today = getAmsterdamCalendarDate(0);
  const tomorrow = getAmsterdamCalendarDate(1);
  const isToday = datum === today;
  const isTomorrow = datum === tomorrow;
  let text: string;
  if (isToday) text = `Ritjes vandaag — ${datum}`;
  else if (isTomorrow) text = `Ritjes voor morgen — ${datum}`;
  else if (datum < today) text = `Eerdere planning — ${datum}`;
  else text = `Ritjes — ${datum}`;
  return { text, isToday, isTomorrow };
}

/**
 * Of deze order bij `targetDate` (YYYY-MM-DD) hoort voor planning-goedkeuren.
 * Bij een tweede batch (ná actieve rit) mag alleen morgen-datum worden meegenomen —
 * daarom niet de losse „vandaag of morgen”-bundel gebruiken voor targetDate=morgen.
 */
export function orderIntendedForPlanningDateKey(
  order: { datum?: unknown; datum_opmerking?: unknown },
  targetDate: string
): boolean {
  const now = getAmsterdamNow();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayKey = toDateKey(now);
  const tomorrowKey = toDateKey(tomorrow);

  const datumStr = String(order.datum ?? "").trim();
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(datumStr);
  if (isoMatch) {
    return isoMatch[1] === targetDate;
  }

  const raw = String(order.datum_opmerking ?? "").trim().toLowerCase();

  const mentions = parseDateMentions(raw, now);
  if (mentions.some((k) => k === targetDate)) return true;
  if (mentions.length > 0) return false;

  const hasVandaag = raw.includes("vandaag");
  const hasMorgen = raw.includes("morgen");

  if (hasMorgen && !hasVandaag && targetDate === tomorrowKey) return true;
  if (hasVandaag && !hasMorgen && targetDate === todayKey) return true;

  return false;
}

/**
 * Expliciet "vandaag leveren" uit datum_opmerking (niet orders.datum — dat is vaak besteldatum).
 */
export function isExplicitVandaagLeveringFromOpmerking(datumOpmerking: unknown): boolean {
  const opm = String(datumOpmerking ?? "").trim().toLowerCase();
  return opm.includes("vandaag") && !opm.includes("morgen");
}

function getAmsterdamNow(baseDate?: Date): Date {
  const now = baseDate ?? new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthToNumber(raw: string): number | null {
  const m = raw.trim().toLowerCase().replace(/\.$/, "");
  const map: Record<string, number> = {
    jan: 1, januari: 1,
    feb: 2, februari: 2,
    mrt: 3, maart: 3,
    apr: 4, april: 4,
    mei: 5,
    jun: 6, juni: 6,
    jul: 7, juli: 7,
    aug: 8, augustus: 8,
    sep: 9, sept: 9, september: 9,
    okt: 10, oktober: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  return map[m] ?? null;
}

function parseDateMentions(input: string, baseDate?: Date): string[] {
  const text = input.toLowerCase();
  const result = new Set<string>();
  const now = getAmsterdamNow(baseDate);
  const currentYear = now.getFullYear();

  // DD-MM[-YYYY], DD/MM[/YYYY], DD.MM[.YYYY]
  const numericRe = /\b([0-3]?\d)\s*[-/.]\s*([01]?\d)(?:\s*[-/.]\s*(\d{2,4}))?\b/g;
  let numericMatch: RegExpExecArray | null = null;
  while ((numericMatch = numericRe.exec(text)) !== null) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const yRaw = numericMatch[3];
    let year = currentYear;
    if (yRaw) {
      year = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      result.add(key);
    }
  }

  // DD maand [YYYY], bv "27 maart" of "27 mrt"
  const monthNameRe =
    /\b([0-3]?\d)\s+(jan(?:uari)?|feb(?:ruari)?|mrt|maart|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|aug(?:ustus)?|sep(?:t(?:ember)?)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{2,4}))?\b/g;
  let monthNameMatch: RegExpExecArray | null = null;
  while ((monthNameMatch = monthNameRe.exec(text)) !== null) {
    const day = Number(monthNameMatch[1]);
    const month = monthToNumber(monthNameMatch[2]);
    if (!month || day < 1 || day > 31) continue;
    const yRaw = monthNameMatch[3];
    let year = currentYear;
    if (yRaw) {
      year = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    }
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    result.add(key);
  }

  return Array.from(result);
}

/**
 * True wanneer datum_opmerking verwijst naar vandaag of morgen (Amsterdam),
 * bijvoorbeeld "vandaag", "morgen", "27-03", "27.3", "27 maart".
 */
export function isDatumOpmerkingVandaagOfMorgen(
  datumOpmerking: unknown,
  baseDate?: Date
): boolean {
  const raw = String(datumOpmerking ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.includes("vandaag") || raw.includes("morgen")) return true;

  const now = getAmsterdamNow(baseDate);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayKey = toDateKey(now);
  const tomorrowKey = toDateKey(tomorrow);

  const mentions = parseDateMentions(raw, now);
  return mentions.some((k) => k === todayKey || k === tomorrowKey);
}
