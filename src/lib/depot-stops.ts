/**
 * Synthetische “Terug naar depot”-stops in de routevolgorde (geen DB-orders).
 * ID-vorm: depot:<routeKey>:<n>
 */

export const DEPOT_STOP_ID_PREFIX = "depot:";

export function isDepotStopId(id: string): boolean {
  return String(id ?? "").startsWith(DEPOT_STOP_ID_PREFIX);
}

export function makeDepotStopId(routeKey: string | number | null, index: number): string {
  const key =
    routeKey == null || routeKey === ""
      ? "overig"
      : String(routeKey).replace(/[^a-zA-Z0-9_-]/g, "");
  return `${DEPOT_STOP_ID_PREFIX}${key}:${Math.max(1, Math.floor(index))}`;
}

/** Alleen echte order-UUIDs uit een gemengde sequence. */
export function orderIdsFromStopSequence(stopIds: string[]): string[] {
  return stopIds.filter((id) => id && !isDepotStopId(id));
}

/**
 * Splits een gemengde sequence op depot-markers in legs van order-IDs.
 * Opeenvolgende depots / lege legs worden overgeslagen.
 */
export function orderIdLegsFromStopSequence(stopIds: string[]): string[][] {
  const legs: string[][] = [];
  let current: string[] = [];
  for (const id of stopIds) {
    if (isDepotStopId(id)) {
      if (current.length > 0) {
        legs.push(current);
        current = [];
      }
      continue;
    }
    if (id) current.push(id);
  }
  if (current.length > 0) legs.push(current);
  return legs.length > 0 ? legs : [];
}

/**
 * Zet order-IDs + leg_nummer om naar sequence met depot-markers tussen deelen.
 */
export function stopSequenceFromOrderLegs(
  orderIds: string[],
  legOf: (orderId: string) => number,
  routeKey: string | number | null
): string[] {
  if (orderIds.length === 0) return [];
  const out: string[] = [];
  let depotN = 0;
  let prevLeg = legOf(orderIds[0]!) || 1;
  for (let i = 0; i < orderIds.length; i++) {
    const id = orderIds[i]!;
    const leg = Math.max(1, legOf(id) || 1);
    if (i > 0 && leg > prevLeg) {
      depotN += 1;
      out.push(makeDepotStopId(routeKey, depotN));
    }
    out.push(id);
    prevLeg = leg;
  }
  return out;
}

/** leg_nummer per order-id uit legs (1-based). */
export function legNummerByOrderId(legs: string[][]): Map<string, number> {
  const map = new Map<string, number>();
  legs.forEach((leg, idx) => {
    for (const id of leg) map.set(id, idx + 1);
  });
  return map;
}
