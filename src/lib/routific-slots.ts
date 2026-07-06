/**
 * Tijdsloten uit Routific-oplossing: stopvolgorde behouden + 20 min uitladen afdwingen.
 * Geen post-processing die volgorde of aankomsttijden verandert — dat veroorzaakte verzonnen slots.
 */

import { parseRoutificArrivalTime } from "@/lib/routific-arrival";
import {
  orderRouteLoad,
  SERVICE_TIME_MINUTES,
  type OrderForRoute,
  type ParallelRouteSpec,
} from "@/lib/routific-payload";
import { maakTijdslot } from "@/lib/tijdslot";

export type RoutificSolutionStop = {
  location_id?: string;
  arrival_time?: string;
  finish_time?: string;
};

export type BuiltRouteSlot = {
  order_id: string;
  aankomsttijd: string;
  arrivalTime: string;
  rit_nummer: number;
  route_nummer: number | null;
};

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

function isDepotLikeStop(locId: string): boolean {
  return locId === "depot" || /_(start|end)$/i.test(locId);
}

/**
 * Zet één Routific-voertuig om naar tijdsloten in Routific-stopvolgorde.
 * Aankomst[i] >= finish[i-1] (finish = aankomst + SERVICE_TIME_MINUTES of Routific finish_time).
 */
export function buildRouteSlotsFromRoutificStops(
  stops: RoutificSolutionStop[],
  orderByVisitId: Map<string, OrderForRoute>,
  routeNummer: number | null
): BuiltRouteSlot[] {
  const results: BuiltRouteSlot[] = [];
  let prevFinishMin: number | null = null;
  let stopIndex = 0;

  for (const stop of stops) {
    const locId = stop.location_id ?? "";
    if (isDepotLikeStop(locId)) continue;

    const order = orderByVisitId.get(locId);
    if (!order) continue;

    const rawArrival = parseRoutificArrivalTime(stop.arrival_time);
    if (!rawArrival) continue;

    let arrivalMin = toMinutes(rawArrival);
    if (prevFinishMin != null && arrivalMin < prevFinishMin) {
      arrivalMin = prevFinishMin;
    }

    const arrivalTime = fromMinutes(arrivalMin);
    const aankomsttijd = maakTijdslot(arrivalTime, order.bezorgtijd_voorkeur);

    const routificFinish = parseRoutificArrivalTime(stop.finish_time);
    const finishFromRoutific =
      routificFinish != null ? toMinutes(routificFinish) : arrivalMin + SERVICE_TIME_MINUTES;
    prevFinishMin = Math.max(arrivalMin + SERVICE_TIME_MINUTES, finishFromRoutific);

    stopIndex += 1;
    results.push({
      order_id: order.id,
      aankomsttijd,
      arrivalTime,
      rit_nummer: stopIndex,
      route_nummer: routeNummer,
    });
  }

  return results;
}

export function extractOrderIdsFromRoutificStops(
  stops: RoutificSolutionStop[],
  orderByVisitId: Map<string, OrderForRoute>
): string[] {
  const ids: string[] = [];
  for (const stop of stops) {
    const locId = stop.location_id ?? "";
    if (isDepotLikeStop(locId)) continue;
    const order = orderByVisitId.get(locId);
    if (order) ids.push(order.id);
  }
  return ids;
}

function routeListLoad(
  orderIds: string[],
  ordersById: Map<string, OrderForRoute>
): number {
  return orderIds.reduce((sum, id) => {
    const o = ordersById.get(id);
    return sum + (o ? orderRouteLoad(o) : 0);
  }, 0);
}

/** Waarschuwing als Routific meer load op een route zet dan geconfigureerde capaciteit. */
export function getRouteCapacityWarnings(
  parallelRoutes: ParallelRouteSpec[],
  routeOrderLists: Map<number, string[]>,
  ordersById: Map<string, OrderForRoute>
): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < parallelRoutes.length; i++) {
    const cap = Math.max(1, parallelRoutes[i]?.capacity ?? 99);
    const ids = routeOrderLists.get(i + 1) ?? [];
    const load = routeListLoad(ids, ordersById);
    if (load > cap) {
      warnings.push(
        `Route ${i + 1}: ${load} load-eenheden ingepland (max ${cap}). Grote fietsen tellen dubbel.`
      );
    }
  }
  return warnings;
}

/** Routelijsten per voertuig uit Routific-oplossing (ongewijzigd). */
export function buildRouteOrderListsFromSolution(
  parallelRoutes: ParallelRouteSpec[],
  solution: Record<string, RoutificSolutionStop[]>,
  orderByVisitId: Map<string, OrderForRoute>
): { lists: Map<number, string[]>; rawLists: Map<number, string[]> } {
  const lists = new Map<number, string[]>();
  const rawLists = new Map<number, string[]>();
  for (let i = 0; i < parallelRoutes.length; i++) {
    const ids = extractOrderIdsFromRoutificStops(
      solution[`vehicle_${i + 1}`] ?? [],
      orderByVisitId
    );
    lists.set(i + 1, [...ids]);
    rawLists.set(i + 1, [...ids]);
  }
  return { lists, rawLists };
}

/** Verplaats handmatig gekozen orders naar hun route (na Routific). */
export function enforcePinnedOrdersOnLists(
  routeOrderLists: Map<number, string[]>,
  parallelRoutes: ParallelRouteSpec[]
): boolean {
  const allPinIds = new Set(parallelRoutes.flatMap((r) => r.orderIds ?? []));
  if (allPinIds.size === 0) return false;

  for (const list of Array.from(routeOrderLists.values())) {
    for (let j = list.length - 1; j >= 0; j--) {
      if (allPinIds.has(list[j]!)) list.splice(j, 1);
    }
  }

  for (let i = 0; i < parallelRoutes.length; i++) {
    const routeNum = i + 1;
    const pins = parallelRoutes[i]?.orderIds ?? [];
    if (pins.length === 0) continue;
    const list = routeOrderLists.get(routeNum) ?? [];
    routeOrderLists.set(routeNum, list);
    for (const id of pins) {
      if (!list.includes(id)) list.unshift(id);
    }
  }
  return true;
}

function listsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/** Routes waar de stopvolgorde afwijkt van Routific → Google Maps herberekenen. */
export function routeListsNeedRecalc(
  finalLists: Map<number, string[]>,
  rawLists: Map<number, string[]>
): Set<number> {
  const needs = new Set<number>();
  for (const [routeNum, final] of Array.from(finalLists.entries())) {
    const raw = rawLists.get(routeNum) ?? [];
    if (!listsEqual(final, raw)) needs.add(routeNum);
  }
  return needs;
}

/**
 * Wijs niet-ingepakte orders toe aan route met meeste resterende capaciteit.
 * Alleen als load past — anders blijven ze zonder tijdslot.
 */
export function assignOrdersWithSpareCapacity(
  candidateIds: string[],
  routeOrderLists: Map<number, string[]>,
  parallelRoutes: ParallelRouteSpec[],
  ordersById: Map<string, OrderForRoute>
): string[] {
  const stillUnassigned: string[] = [];
  const capacityFor = (routeNum: number) =>
    Math.max(1, parallelRoutes[routeNum - 1]?.capacity ?? 99);

  for (const id of candidateIds) {
    const order = ordersById.get(id);
    if (!order) continue;
    const load = orderRouteLoad(order);

    let bestRoute = -1;
    let bestRemaining = -1;
    for (let routeNum = 1; routeNum <= parallelRoutes.length; routeNum++) {
      const list = routeOrderLists.get(routeNum) ?? [];
      const remaining = capacityFor(routeNum) - routeListLoad(list, ordersById);
      if (remaining >= load && remaining > bestRemaining) {
        bestRemaining = remaining;
        bestRoute = routeNum;
      }
    }

    if (bestRoute < 0) {
      stillUnassigned.push(id);
      continue;
    }
    const list = routeOrderLists.get(bestRoute) ?? [];
    list.push(id);
    routeOrderLists.set(bestRoute, list);
  }
  return stillUnassigned;
}
