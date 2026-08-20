/**
 * Berekent een tijdslot (2 uur) rond een verwachte aankomsttijd.
 *
 * Belangrijk: de **echte aankomst** uit de route is leidend.
 * - "na …" beïnvloedt alleen Routific-planning, niet het getoonde slot.
 * - "voor …" / "tussen …" mogen het 2-uursvenster alleen verschuiven als de
 *   aankomst daar nog in past. Nooit een vroeg/laat slot verzinnen dat de
 *   aankomst buiten het venster zet.
 */

import { parseBezorgtijdRestriction } from "@/lib/bezorgtijd-window";

const SLOT_DURATION_MIN = 120;
const DEFAULT_BEFORE_MIN = 45;

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

function defaultSlotAroundArrival(arrival: number): string {
  return formatSlotRange(arrival - DEFAULT_BEFORE_MIN);
}

function arrivalInside(arrival: number, slotStart: number): boolean {
  return arrival >= slotStart && arrival <= slotStart + SLOT_DURATION_MIN;
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
    return defaultSlotAroundArrival(arrival);
  }

  if (res.kind === "na") {
    // "na HH:mm" stuurt alleen de Routific-planning (visit start). Het getoonde
    // 2-uurs slot volgt altijd de echte aankomst — niet forceren naar minStart
    // (dat gaf bv. "16:00–18:00" terwijl arrival-45 natuurlijker was).
    return defaultSlotAroundArrival(arrival);
  }

  if (res.kind === "voor") {
    const maxEnd = toMinutes(res.maxEnd);
    // Aankomst ná deadline → toon eerlijk aankomst-slot (niet terugspoelen naar 12:00–14:00).
    if (arrival > maxEnd) {
      return defaultSlotAroundArrival(arrival);
    }
    // Liever slot dat eindigt op de deadline, als aankomst daar nog in valt.
    const preferredStart = maxEnd - SLOT_DURATION_MIN;
    if (arrivalInside(arrival, preferredStart)) {
      return formatSlotRange(preferredStart);
    }
    let slotStart = arrival - DEFAULT_BEFORE_MIN;
    if (slotStart + SLOT_DURATION_MIN > maxEnd) {
      slotStart = maxEnd - SLOT_DURATION_MIN;
    }
    if (!arrivalInside(arrival, slotStart)) {
      return defaultSlotAroundArrival(arrival);
    }
    return formatSlotRange(slotStart);
  }

  const minStart = toMinutes(res.minStart);
  const maxEnd = toMinutes(res.maxEnd);
  // Aankomst buiten "tussen … en …" → eerlijk aankomst-slot.
  if (arrival < minStart || arrival > maxEnd) {
    return defaultSlotAroundArrival(arrival);
  }

  let slotStart: number;
  if (arrival >= maxEnd - SLOT_DURATION_MIN) {
    slotStart = maxEnd - SLOT_DURATION_MIN;
  } else {
    slotStart = Math.max(minStart, arrival - DEFAULT_BEFORE_MIN);
    if (slotStart + SLOT_DURATION_MIN > maxEnd) {
      slotStart = maxEnd - SLOT_DURATION_MIN;
    }
  }
  if (!arrivalInside(arrival, slotStart)) {
    return defaultSlotAroundArrival(arrival);
  }
  return formatSlotRange(slotStart);
}
