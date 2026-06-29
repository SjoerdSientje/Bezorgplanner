/**
 * Berekent een tijdslot (2 uur) rond een verwachte aankomsttijd.
 * Standaard: 45 min voor, 75 min na aankomst. Bij tijdsrestrictie wordt het slot
 * binnen die restrictie gelegd zodat de aankomsttijd er altijd in valt.
 * Geen ChatGPT: logica gehardcode.
 */

const SLOT_DURATION_MIN = 120;
const DEFAULT_BEFORE_MIN = 45;
const DEFAULT_AFTER_MIN = 75;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

function fromMinutes(total: number): string {
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatSlotRange(slotStart: number): string {
  return `${fromMinutes(slotStart)} - ${fromMinutes(slotStart + SLOT_DURATION_MIN)}`;
}

/** Parsed tijdsrestrictie: "na X", "voor X", of "tussen A en B" */
type Restriction =
  | { type: "na"; minStart: string }
  | { type: "voor"; maxEnd: string }
  | { type: "tussen"; minStart: string; maxEnd: string };

function parseRestriction(text: string | null | undefined): Restriction | null {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw || raw === "geen" || raw === "geen opmerking") return null;

  /**
   * Zelfde logica als routific-payload: "na 2" zonder :mm → 14:00 (uren 1–6 als middag).
   * Alleen als middagBare true (extractie uit na/voor/tussen).
   */
  const tijdMatch = (s: string, middagBare: boolean) => {
    const m = s.match(/(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
    const m2 = s.match(/(\d{1,2})\s*(?:uur|u\.?)?/);
    if (m2) {
      let h = parseInt(m2[1], 10);
      const hasColon = /:/.test(s);
      if (middagBare && !hasColon && h >= 1 && h <= 6) {
        h += 12;
      }
      return `${String(h).padStart(2, "0")}:00`;
    }
    return null;
  };

  if (/^\s*na\s+/i.test(raw) || /\bna\s+\d/i.test(raw)) {
    const t = raw.replace(/.*?(\d{1,2}(?::\d{2})?(?:\s*uur)?).*/, "$1");
    const start = tijdMatch(t || raw, true);
    if (start) return { type: "na", minStart: start };
  }
  if (/^\s*voor\s+/i.test(raw) || /\bvoor\s+\d/i.test(raw)) {
    const t = raw.replace(/.*?(\d{1,2}(?::\d{2})?(?:\s*uur)?).*/, "$1");
    const end = tijdMatch(t || raw, true);
    if (end) return { type: "voor", maxEnd: end };
  }
  const tussen = raw.match(/tussen\s*(\d{1,2}(?::\d{2})?(?:\s*uur)?)\s*en\s*(\d{1,2}(?::\d{2})?(?:\s*uur)?)/i);
  if (tussen) {
    const a = tijdMatch(tussen[1], true);
    const b = tijdMatch(tussen[2], true);
    if (a && b) return { type: "tussen", minStart: a, maxEnd: b };
  }
  const twoTimes = raw.match(/(\d{1,2}):(\d{2})\s*[-–tot en]\s*(\d{1,2}):(\d{2})/i);
  if (twoTimes) {
    return {
      type: "tussen",
      minStart: `${twoTimes[1].padStart(2, "0")}:${twoTimes[2]}`,
      maxEnd: `${twoTimes[3].padStart(2, "0")}:${twoTimes[4]}`,
    };
  }
  return null;
}

/**
 * Maakt een tijdslot "HH:mm - HH:mm" (2 uur) rond de verwachte aankomsttijd.
 * - Zonder restrictie: 45 min voor, 75 min na (bijv. 13:07 → 12:22 - 14:22).
 * - Met restrictie wordt het slot binnen de restrictie gelegd; aankomsttijd valt altijd in het slot.
 */
export function maakTijdslot(
  aankomsttijd: string,
  tijdsrestrictieOpmerking: string | null | undefined
): string {
  const arrival = toMinutes(aankomsttijd);
  const res = parseRestriction(tijdsrestrictieOpmerking);

  if (!res) {
    return formatSlotRange(arrival - DEFAULT_BEFORE_MIN);
  }

  if (res.type === "na") {
    const minStart = toMinutes(res.minStart);
    const slotStart = Math.max(minStart, arrival - DEFAULT_BEFORE_MIN);
    return formatSlotRange(slotStart);
  }

  if (res.type === "voor") {
    const maxEnd = toMinutes(res.maxEnd);
    const slotEnd = Math.min(maxEnd, arrival + DEFAULT_AFTER_MIN);
    const slotStart = slotEnd - SLOT_DURATION_MIN;
    return formatSlotRange(slotStart);
  }

  // tussen A en B: 2h binnen [A,B] met aankomst erin
  const minStart = toMinutes(res.minStart);
  const maxEnd = toMinutes(res.maxEnd);
  let slotStart: number;
  if (arrival >= maxEnd - SLOT_DURATION_MIN) {
    slotStart = maxEnd - SLOT_DURATION_MIN;
  } else {
    slotStart = Math.max(minStart, arrival - DEFAULT_BEFORE_MIN);
    if (slotStart + SLOT_DURATION_MIN > maxEnd) {
      slotStart = maxEnd - SLOT_DURATION_MIN;
    }
  }
  return formatSlotRange(slotStart);
}
