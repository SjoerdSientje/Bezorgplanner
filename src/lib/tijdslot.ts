/**
 * Berekent een tijdslot (2 uur) rond een verwachte aankomsttijd.
 */

import { parseBezorgtijdRestriction } from "@/lib/bezorgtijd-window";

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

/**
 * Maakt een tijdslot "HH:mm - HH:mm" (2 uur) rond de verwachte aankomsttijd.
 */
export function maakTijdslot(
  aankomsttijd: string,
  tijdsrestrictieOpmerking: string | null | undefined
): string {
  const arrival = toMinutes(aankomsttijd);
  const res = parseBezorgtijdRestriction(tijdsrestrictieOpmerking);

  if (!res) {
    return formatSlotRange(arrival - DEFAULT_BEFORE_MIN);
  }

  if (res.kind === "na") {
    const minStart = toMinutes(res.minStart);
    const slotStart = Math.max(minStart, arrival - DEFAULT_BEFORE_MIN);
    return formatSlotRange(slotStart);
  }

  if (res.kind === "voor") {
    const maxEnd = toMinutes(res.maxEnd);
    const slotEnd = Math.min(maxEnd, arrival + DEFAULT_AFTER_MIN);
    const slotStart = slotEnd - SLOT_DURATION_MIN;
    return formatSlotRange(slotStart);
  }

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
