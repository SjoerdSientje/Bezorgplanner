/**
 * Bepalen van de planningdatum: voor cutoff = vandaag, vanaf cutoff = morgen.
 * Tijdzone: Europe/Amsterdam.
 * @param cutoffHour Uur (0-23) waarop overgegaan wordt naar morgen; standaard 18.
 */
export function getPlanningDate(cutoffHour: number = 18): { date: string; isTomorrow: boolean } {
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

/** Planningdatum voor 'Planning goedkeuren': vanaf 17:00 = morgen. */
export function getPlanningDateForGoedkeuren() {
  return getPlanningDate(17);
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
