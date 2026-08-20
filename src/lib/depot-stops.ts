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

export type OrderOrDepotSegment =
  | { kind: "orders"; orderIndices: number[] }
  | { kind: "depot"; partAfter: number };

/**
 * Deel een gesorteerde orderlijst in segmenten met depot-breaks op leg_nummer.
 * `orderIndices` verwijst naar indices in de aangeleverde `orderIds`-array.
 */
export function segmentsFromOrderLegs(
  orderIds: string[],
  legOf: (orderId: string) => number,
  routeKey: string | number | null
): OrderOrDepotSegment[] {
  const seq = stopSequenceFromOrderLegs(orderIds, legOf, routeKey);
  const idToIdx = new Map(orderIds.map((id, i) => [id, i]));
  const segments: OrderOrDepotSegment[] = [];
  let current: number[] = [];
  let depotCount = 0;

  for (const sid of seq) {
    if (isDepotStopId(sid)) {
      if (current.length > 0) {
        segments.push({ kind: "orders", orderIndices: current });
        current = [];
      }
      depotCount += 1;
      segments.push({ kind: "depot", partAfter: depotCount + 1 });
      continue;
    }
    const idx = idToIdx.get(sid);
    if (idx != null) current.push(idx);
  }
  if (current.length > 0) segments.push({ kind: "orders", orderIndices: current });
  return segments;
}

export function orderLegNummerValue(raw: unknown): number {
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
