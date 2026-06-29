/**
 * Normaliseert Routific arrival_time naar HH:MM (24u).
 */

export function parseRoutificArrivalTime(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;

  const withMeridiem = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/);
  if (withMeridiem) {
    let h = parseInt(withMeridiem[1]!, 10);
    const m = parseInt(withMeridiem[2]!, 10);
    const meridiem = withMeridiem[3]!;
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    return null;
  }

  const hhmm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) {
    const h = parseInt(hhmm[1]!, 10);
    const m = parseInt(hhmm[2]!, 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  return null;
}
