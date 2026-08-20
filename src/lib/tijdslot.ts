/**
 * Berekent een tijdslot (2 uur) rond een verwachte aankomsttijd.
 *
 * De **echte aankomst** uit de route is altijd leidend voor het getoonde slot.
 * Tijdsrestricties ("na" / "voor" / "tussen") sturen alleen de Routific-planning
 * (hard start/end) — ze forceren het 2-uurs klantslot niet meer naar de deadline.
 */

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

function defaultSlotAroundArrival(arrival: number): string {
  const slotStart = arrival - DEFAULT_BEFORE_MIN;
  return `${fromMinutes(slotStart)} - ${fromMinutes(slotStart + SLOT_DURATION_MIN)}`;
}

/**
 * Maakt een tijdslot "HH:mm - HH:mm" (2 uur) rond de verwachte aankomsttijd.
 * `tijdsrestrictieOpmerking` wordt bewust genegeerd voor weergave.
 */
export function maakTijdslot(
  aankomsttijd: string,
  _tijdsrestrictieOpmerking?: string | null
): string {
  return defaultSlotAroundArrival(toMinutes(aankomsttijd));
}
