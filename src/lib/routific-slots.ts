/**
 * Tijdsloten uit Routific-oplossing: volgorde behouden + 20 min uitladen afdwingen.
 */

import { parseRoutificArrivalTime } from "@/lib/routific-arrival";
import {
  earliestParallelShiftStart,
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
      (id) => !pinsOtherRoutes.has(id)
    );

    const merged: string[] = [];
    const seen = new Set<string>();

    for (const id of pinsThisRoute) {
      if (!seen.has(id)) {
        merged.push(id);
        seen.add(id);
      }
    }
    for (const id of fromRoutific) {
      if (seen.has(id)) continue;
      merged.push(id);
      seen.add(id);
    }

    result.set(routeNum, merged);
  }

  return result;
}

/** Vul orders in die Routific niet kon/plan niet (verdeel over route met minste stops). */
export function appendUnassignedOrdersToRoutes(
  allOrderIds: string[],
  routeOrderLists: Map<number, string[]>
): void {
  const assigned = new Set(Array.from(routeOrderLists.values()).flat());
  const unrouted = allOrderIds.filter((id) => !assigned.has(id));
  if (unrouted.length === 0) return;

  for (const id of unrouted) {
    let targetRoute = 1;
    let minLen = Infinity;
    for (const [routeNum, list] of routeOrderLists) {
      if (list.length < minLen) {
        minLen = list.length;
        targetRoute = routeNum;
      }
    }
    const list = routeOrderLists.get(targetRoute);
    if (list) list.push(id);
    else routeOrderLists.set(targetRoute, [id]);
  }
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
    let arrivalMin = routificArrival
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
