/**
 * Capaciteitsverdeling voor ritten (puur, geen Google/Routific).
 */

export type CapacityStop = {
  id: string;
  load?: number;
};

function stopLoad(s: CapacityStop): number {
  return Math.max(1, Math.floor(Number(s.load ?? 1)));
}

export function totalRouteStopLoad(stops: CapacityStop[]): number {
  return stops.reduce((sum, s) => sum + stopLoad(s), 0);
}

/** Splits stops in delen zodra voertuigcapaciteit vol is (voor terug naar depot). */
export function splitStopsByVehicleCapacity<T extends CapacityStop>(
  stops: T[],
  capacity: number
): T[][] {
  const cap = Math.max(1, Math.floor(Number(capacity) || 1));
  const legs: T[][] = [];
  let current: T[] = [];
  let load = 0;
  for (const s of stops) {
    const l = Math.max(1, Math.floor(Number(s.load ?? 1)));
    if (current.length > 0 && load + l > cap) {
      legs.push(current);
      current = [];
      load = 0;
    }
    current.push(s);
    load += l;
  }
  if (current.length > 0) legs.push(current);
  return legs;
}

/**
 * Verdeel stops over precies ceil(load/cap) ritten, zo gelijk mogelijk,
 * zonder capaciteit te overschrijden. Bij 9 load / max 4 → mik op 3+3+3 i.p.v. 4+4+1.
 */
export function splitStopsBalancedByCapacity<T extends CapacityStop>(
  stops: T[],
  capacity: number
): T[][] {
  const cap = Math.max(1, Math.floor(Number(capacity) || 1));
  if (stops.length === 0) return [];
  const total = totalRouteStopLoad(stops);
  const minLegs = Math.max(1, Math.ceil(total / cap));
  if (minLegs <= 1) return [stops];

  const legs: T[][] = [];
  let idx = 0;

  for (let leg = 0; leg < minLegs; leg++) {
    const legsLeft = minLegs - leg;
    const remaining = stops.slice(idx);
    const remLoad = totalRouteStopLoad(remaining);
    const target = Math.ceil(remLoad / legsLeft);
    const current: T[] = [];
    let load = 0;

    while (idx < stops.length) {
      const s = stops[idx]!;
      const l = stopLoad(s);
      if (current.length > 0 && load + l > cap) break;

      if (current.length > 0 && load >= target && leg < minLegs - 1) {
        const loadAfter = remLoad - load;
        if (loadAfter <= (legsLeft - 1) * cap) break;
      }

      current.push(s);
      load += l;
      idx++;
      if (load >= cap) break;
    }

    if (current.length === 0 && idx < stops.length) {
      current.push(stops[idx]!);
      idx++;
    }
    if (current.length > 0) legs.push(current);
  }

  while (idx < stops.length) {
    const s = stops[idx]!;
    const l = stopLoad(s);
    const last = legs[legs.length - 1];
    if (last && totalRouteStopLoad(last) + l <= cap) {
      last.push(s);
    } else {
      legs.push([s]);
    }
    idx++;
  }

  return legs;
}
