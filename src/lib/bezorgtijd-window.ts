/**
 * Gedeelde parser voor bezorgtijd-voorkeur → Routific-tijdvenster.
 * Gebruikt door routific-payload (planning) en tijdslot (weergave).
 */

export type Tijdvenster =
  | { start: string; end: string }
  | { start: string; end: null }; // end: null = anytime after start (Routific)

export type RestrictionKind = "na" | "voor" | "tussen";

export type ParsedRestriction =
  | { kind: "na"; minStart: string }
  | { kind: "voor"; maxEnd: string }
  | { kind: "tussen"; minStart: string; maxEnd: string };

function parseHourToken(token: string, middagBare: boolean): string | null {
  // Zowel "11:30" als "11.30" (NL-schrijfwijze met punt i.p.v. dubbele punt) accepteren.
  const withColon = token.match(/(\d{1,2})[:.](\d{2})/);
  if (withColon) {
    const h = parseInt(withColon[1]!, 10);
    const m = parseInt(withColon[2]!, 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    return null;
  }
  const hourOnly = token.match(/(\d{1,2})/);
  if (!hourOnly) return null;
  let h = parseInt(hourOnly[1]!, 10);
  if (middagBare && h >= 1 && h <= 6) h += 12;
  if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  return null;
}

/** Parsed restrictie voor tijdslot-weergave. */
export function parseBezorgtijdRestriction(
  text: string | null | undefined
): ParsedRestriction | null {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw || raw === "geen" || raw === "geen opmerking") return null;

  // Minuten mogen met ":" of "." geschreven zijn (NL-schrijfwijze, bv. "11.30").
  const naMatch = raw.match(/\b(?:pas\s+)?na\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*uur)?\b/i);
  if (naMatch) {
    const token = naMatch[2] != null ? `${naMatch[1]}:${naMatch[2]}` : naMatch[1]!;
    const start = parseHourToken(token, naMatch[2] == null);
    if (start) return { kind: "na", minStart: start };
  }

  const voorMatch = raw.match(
    /\b(?:voor|uiterlijk|max\.?|ten\s+laatste|t\.l\.)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*uur)?\b/i
  );
  if (voorMatch) {
    const token = voorMatch[2] != null ? `${voorMatch[1]}:${voorMatch[2]}` : voorMatch[1]!;
    const end = parseHourToken(token, voorMatch[2] == null);
    if (end) return { kind: "voor", maxEnd: end };
  }

  const tussen = raw.match(/tussen\s*(\d{1,2}(?:[:.]\d{2})?(?:\s*uur)?)\s*en\s*(\d{1,2}(?:[:.]\d{2})?(?:\s*uur)?)/i);
  if (tussen) {
    const a = parseHourToken(tussen[1]!, true);
    const b = parseHourToken(tussen[2]!, true);
    if (a && b) return { kind: "tussen", minStart: a, maxEnd: b };
  }

  const times: string[] = [];
  const hhmm = /\b(\d{1,2}):(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = hhmm.exec(raw)) !== null) {
    const hour = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      times.push(`${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
    }
  }
  if (times.length === 0) {
    const uurOnly = /\b(\d{1,2})\s*(?:uur|u\.?)\b/gi;
    while ((m = uurOnly.exec(raw)) !== null) {
      const hour = parseInt(m[1], 10);
      if (hour >= 0 && hour <= 23) times.push(`${String(hour).padStart(2, "0")}:00`);
    }
  }
  if (times.length >= 2) return { kind: "tussen", minStart: times[0]!, maxEnd: times[1]! };
  if (times.length === 1) return { kind: "na", minStart: times[0]! };

  return null;
}

const DEFAULT_SHIFT_END = "23:59";

/**
 * Routific visit-venster uit bezorgtijd-voorkeur.
 * - "voor 15:00" → start = shiftStart, end = 15:00 (Routific plant vóór deadline)
 * - "na 15:00" → start = 15:00, geen end
 */
export function parseBezorgtijdVoorkeur(
  text: string | null | undefined,
  shiftStart: string
): Tijdvenster | null {
  const res = parseBezorgtijdRestriction(text);
  if (!res) return null;

  if (res.kind === "na") {
    return { start: res.minStart, end: null };
  }
  if (res.kind === "voor") {
    return { start: shiftStart, end: res.maxEnd };
  }
  return { start: res.minStart, end: res.maxEnd };
}
