/**
 * Tijdsloten uit Routific-oplossing: volgorde behouden + 20 min uitladen afdwingen.
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
  /** Stopvolgorde binnen deze route (1, 2, 3 …) — Routific-rijvolgorde. */
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
 * Zet één Routific-voertuig om naar tijdsloten.
 * Loopt in Routific-rijvolgorde en dwingt af: aankomst[i] >= finish[i-1]
 * (finish = aankomst + SERVICE_TIME_MINUTES, tenzij Routific een latere finish_time geeft).
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

/** Combineer handmatig gekozen orders met Routific-volgorde voor de overige stops. */
export function mergePartialManualRouteOrders(
  parallelRoutes: ParallelRouteSpec[],
  routificOrdersByVehicle: string[][]
): Map<number, string[]> {
  const result = new Map<number, string[]>();

  for (let i = 0; i < parallelRoutes.length; i++) {
    const routeNum = i + 1;
    const pinsThisRoute = parallelRoutes[i]?.orderIds ?? [];
    const pinsOtherRoutes = new Set(
      parallelRoutes.flatMap((r, j) => (j === i ? [] : (r.orderIds ?? [])))
    );

    const fromRoutific = (routificOrdersByVehicle[i] ?? []).filter(
      (id) => !pinsOtherRoutes.has(id) && !pinsThisRoute.includes(id)
    );

    const merged: string[] = [...pinsThisRoute];
    for (const id of fromRoutific) {
      if (!merged.includes(id)) merged.push(id);
    }

    result.set(routeNum, merged);
  }

  return result;
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

/** Verplaats handmatig gekozen orders naar hun route (uit andere routes). */
export function applyPinnedOrdersToRoutes(
  routeOrderLists: Map<number, string[]>,
  parallelRoutes: ParallelRouteSpec[]
): void {
  const allPins = new Set(parallelRoutes.flatMap((r) => r.orderIds ?? []));

  for (const list of Array.from(routeOrderLists.values())) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (allPins.has(list[i]!)) list.splice(i, 1);
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
}

/** Herverdeel orders zodat geen route boven max. fietsen-capaciteit uitkomt (pins blijven staan). */
export function rebalanceRoutesByCapacity(
  routeOrderLists: Map<number, string[]>,
  parallelRoutes: ParallelRouteSpec[],
  ordersById: Map<string, OrderForRoute>,
  pinnedIds: Set<string>
): void {
  const capacityFor = (routeNum: number) =>
    Math.max(1, parallelRoutes[routeNum - 1]?.capacity ?? 99);

  for (let pass = 0; pass < 20; pass++) {
    let changed = false;

    for (let routeNum = 1; routeNum <= parallelRoutes.length; routeNum++) {
      const list = routeOrderLists.get(routeNum) ?? [];
      const cap = capacityFor(routeNum);

      while (routeListLoad(list, ordersById) > cap) {
        const moveIdx = [...list].reverse().findIndex((id) => !pinnedIds.has(id));
        if (moveIdx < 0) break;

        const idx = list.length - 1 - moveIdx;
        const [movedId] = list.splice(idx, 1);
        const movedLoad = orderRouteLoad(ordersById.get(movedId)!);

        let placed = false;
        for (let target = 1; target <= parallelRoutes.length; target++) {
          if (target === routeNum) continue;
          const targetList = routeOrderLists.get(target) ?? [];
          const targetCap = capacityFor(target);
          if (routeListLoad(targetList, ordersById) + movedLoad <= targetCap) {
            targetList.push(movedId);
            routeOrderLists.set(target, targetList);
            placed = true;
            changed = true;
            break;
          }
        }

        if (!placed) {
          list.splice(idx, 0, movedId);
          break;
        }
      }
    }

    if (!changed) break;
  }
}

/** Vul orders in die Routific niet inplannde (capaciteit-gewogen). */
export function appendUnassignedOrdersToRoutes(
  allOrderIds: string[],
  routeOrderLists: Map<number, string[]>,
  parallelRoutes: ParallelRouteSpec[],
  ordersById: Map<string, OrderForRoute>
): void {
  const assigned = new Set(Array.from(routeOrderLists.values()).flat());
  const unrouted = allOrderIds.filter((id) => !assigned.has(id));
  if (unrouted.length === 0) return;

  const capacityFor = (routeNum: number) =>
    Math.max(1, parallelRoutes[routeNum - 1]?.capacity ?? 99);

  for (const id of unrouted) {
    const order = ordersById.get(id);
    if (!order) continue;
    const load = orderRouteLoad(order);

    let targetRoute = 1;
    let bestRemaining = -Infinity;

    for (let routeNum = 1; routeNum <= parallelRoutes.length; routeNum++) {
      const list = routeOrderLists.get(routeNum) ?? [];
      const remaining = capacityFor(routeNum) - routeListLoad(list, ordersById);
      if (remaining >= load && remaining > bestRemaining) {
        bestRemaining = remaining;
        targetRoute = routeNum;
      }
    }

    if (bestRemaining < load) {
      for (let routeNum = 1; routeNum <= parallelRoutes.length; routeNum++) {
        const list = routeOrderLists.get(routeNum) ?? [];
        const remaining = capacityFor(routeNum) - routeListLoad(list, ordersById);
        if (remaining > bestRemaining) {
          bestRemaining = remaining;
          targetRoute = routeNum;
        }
      }
    }

    const list = routeOrderLists.get(targetRoute) ?? [];
    list.push(id);
    routeOrderLists.set(targetRoute, list);
  }
}

/** Bouw routelijsten vanuit Routific + pins + capaciteit; elke order precies één route. */
export function buildFinalRouteOrderLists(
  parallelRoutes: ParallelRouteSpec[],
  solution: Record<string, RoutificSolutionStop[]>,
  vehicleKeys: string[],
  orderByVisitId: Map<string, OrderForRoute>,
  allOrderIds: string[],
  ordersById: Map<string, OrderForRoute>
): Map<number, string[]> {
  const routeOrderLists = new Map<number, string[]>();

  for (let i = 0; i < parallelRoutes.length; i++) {
    const vehicleKey = vehicleKeys[i] ?? `vehicle_${i + 1}`;
    routeOrderLists.set(
      i + 1,
      extractOrderIdsFromRoutificStops(solution[vehicleKey] ?? [], orderByVisitId)
    );
  }

  const pinnedIds = new Set(parallelRoutes.flatMap((r) => r.orderIds ?? []));
  if (pinnedIds.size > 0) {
    applyPinnedOrdersToRoutes(routeOrderLists, parallelRoutes);
  }

  appendUnassignedOrdersToRoutes(allOrderIds, routeOrderLists, parallelRoutes, ordersById);
  rebalanceRoutesByCapacity(routeOrderLists, parallelRoutes, ordersById, pinnedIds);
  appendUnassignedOrdersToRoutes(allOrderIds, routeOrderLists, parallelRoutes, ordersById);

  return routeOrderLists;
}

/** Waarschuwingen als een route na post-processing boven max. fietsen zit. */
export function getRouteCapacityWarnings(
  routeOrderLists: Map<number, string[]>,
  parallelRoutes: ParallelRouteSpec[],
  ordersById: Map<string, OrderForRoute>
): string[] {
  const warnings: string[] = [];
  for (let routeNum = 1; routeNum <= parallelRoutes.length; routeNum++) {
    const cap = Math.max(1, parallelRoutes[routeNum - 1]?.capacity ?? 99);
    const list = routeOrderLists.get(routeNum) ?? [];
    const load = routeListLoad(list, ordersById);
    if (load > cap) {
      warnings.push(
        `Route ${routeNum}: ${load} fiets-eenheden ingepland (max ${cap}). Controleer handmatige adressen of grote fietsen.`
      );
    }
  }
  return warnings;
}

export function buildArrivalTimeMapFromSolution(
  solution: Record<string, RoutificSolutionStop[]>,
  orderByVisitId: Map<string, OrderForRoute>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const stops of Object.values(solution ?? {})) {
    for (const stop of stops) {
      const locId = stop.location_id ?? "";
      if (isDepotLikeStop(locId)) continue;
      const order = orderByVisitId.get(locId);
      const arrival = parseRoutificArrivalTime(stop.arrival_time);
      if (order && arrival) map.set(order.id, arrival);
    }
  }
  return map;
}

/** Tijdsloten voor een vaste stopvolgorde (o.a. na handmatige + Routific merge). */
export function buildRouteSlotsFromOrderSequence(
  orderIds: string[],
  arrivalByOrderId: Map<string, string>,
  routeNummer: number,
  ordersById: Map<string, OrderForRoute>,
  defaultStart: string
): BuiltRouteSlot[] {
  const results: BuiltRouteSlot[] = [];
  let prevFinishMin: number | null = null;
  let stopIndex = 0;

  for (const orderId of orderIds) {
    const order = ordersById.get(orderId);
    if (!order) continue;

    const routificArrival = arrivalByOrderId.get(orderId);
    let arrivalMin: number = routificArrival
      ? toMinutes(routificArrival)
      : prevFinishMin ?? toMinutes(defaultStart);

    if (prevFinishMin != null && arrivalMin < prevFinishMin) {
      arrivalMin = prevFinishMin;
    }

    const arrivalTime = fromMinutes(arrivalMin);
    const aankomsttijd = maakTijdslot(arrivalTime, order.bezorgtijd_voorkeur);
    prevFinishMin = arrivalMin + SERVICE_TIME_MINUTES;
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
