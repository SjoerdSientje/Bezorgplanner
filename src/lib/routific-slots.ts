/**
 * Tijdsloten uit Routific-oplossing: stopvolgorde behouden + 20 min uitladen afdwingen.
 * Bij meerdere ritten: na elk deel terug naar depot + herladen meenemen in de tijden.
 */

import { parseRoutificArrivalTime } from "@/lib/routific-arrival";
import {
  DEPOT_RELOAD_MINUTES,
  orderRouteLoad,
  SERVICE_TIME_MINUTES,
  type OrderForRoute,
  type ParallelRouteSpec,
} from "@/lib/routific-payload";
import {
  recalculateRouteStopsWithDepotReturns,
  splitStopsBalancedByCapacity,
  type RouteStop,
} from "@/lib/route-recalc";
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
  /** Deel binnen dezelfde route (1, 2, …) bij terug naar depot. */
  leg_nummer: number;
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
 * Zet één Routific-voertuig/leg om naar tijdsloten in Routific-stopvolgorde.
 * Aankomst[i] >= finish[i-1] (finish = aankomst + SERVICE_TIME_MINUTES of Routific finish_time).
 */
export function buildRouteSlotsFromRoutificStops(
  stops: RoutificSolutionStop[],
  orderByVisitId: Map<string, OrderForRoute>,
  routeNummer: number | null,
  options?: { legNummer?: number; ritNummerOffset?: number }
): BuiltRouteSlot[] {
  const results: BuiltRouteSlot[] = [];
  let prevFinishMin: number | null = null;
  let stopIndex = options?.ritNummerOffset ?? 0;
  const legNummer = Math.max(1, options?.legNummer ?? 1);

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
      leg_nummer: legNummer,
    });
  }

  return results;
}

/**
 * Meerdere Routific-legs van één route → één tijdlijn.
 *
 * Nooit meer ritten dan ceil(load/capaciteit). Binnen dat minimum kiezen we de
 * verdeling met de kortste totale rijtijd: volle bus (4+4+1), gebalanceerd (3+3+3),
 * of Routific's eigen split — zodat we niet onnodig terugrijden, maar ook niet
 * blind 4+4+1 forceren als 3+3+3 geografisch beter is.
 */
export async function buildRouteSlotsFromMultiLegSolution(
  legStopsList: RoutificSolutionStop[][],
  orderByVisitId: Map<string, OrderForRoute>,
  routeNummer: number | null,
  options?: { capacity?: number; vertrektijd?: string }
): Promise<BuiltRouteSlot[]> {
  type TimedVisit = { order: OrderForRoute; arrivalMin: number };
  const visits: TimedVisit[] = [];
  const seen = new Set<string>();
  const routificLegOrders: OrderForRoute[][] = [];

  for (const stops of legStopsList) {
    const legOrders: OrderForRoute[] = [];
    for (const stop of stops) {
      const locId = stop.location_id ?? "";
      if (isDepotLikeStop(locId)) continue;
      const order = orderByVisitId.get(locId);
      if (!order || seen.has(order.id)) continue;
      const rawArrival = parseRoutificArrivalTime(stop.arrival_time);
      if (!rawArrival) continue;
      seen.add(order.id);
      visits.push({ order, arrivalMin: toMinutes(rawArrival) });
      legOrders.push(order);
    }
    if (legOrders.length > 0) routificLegOrders.push(legOrders);
  }

  if (visits.length === 0) return [];

  visits.sort((a, b) => a.arrivalMin - b.arrivalMin);

  const rawCap = options?.capacity;
  const capacity =
    rawCap == null || !Number.isFinite(Number(rawCap)) || Number(rawCap) < 1
      ? 0
      : Math.max(1, Math.floor(Number(rawCap)));
  const vertrektijd =
    String(options?.vertrektijd ?? "").trim() ||
    fromMinutes(Math.max(0, visits[0]!.arrivalMin - 30));

  // Zonder capaciteit (geen "terug naar depot"): één doorlopende rit.
  if (capacity < 1) {
    return buildRouteSlotsFromRoutificStops(
      visits.map((v) => ({
        location_id: v.order.id,
        arrival_time: fromMinutes(v.arrivalMin),
      })),
      orderByVisitId,
      routeNummer,
      { legNummer: 1 }
    );
  }

  const routeStops: RouteStop[] = visits.map(({ order }) => ({
    id: order.id,
    volledig_adres: String(order.volledig_adres ?? "").trim(),
    bezorgtijd_voorkeur: order.bezorgtijd_voorkeur,
    load: orderRouteLoad(order),
  }));

  const routificLegs: RouteStop[][] = routificLegOrders.map((orders) =>
    orders.map((order) => ({
      id: order.id,
      volledig_adres: String(order.volledig_adres ?? "").trim(),
      bezorgtijd_voorkeur: order.bezorgtijd_voorkeur,
      load: orderRouteLoad(order),
    }))
  );

  if (routeStops.some((s) => !s.volledig_adres)) {
    return buildPackedSlotsFromRoutificTimes(
      visits,
      orderByVisitId,
      routeNummer,
      capacity
    );
  }

  try {
    const recalculated = await recalculateRouteStopsWithDepotReturns(
      routeStops,
      vertrektijd,
      capacity,
      { routificLegs }
    );
    return recalculated.map((s, i) => ({
      order_id: s.id,
      aankomsttijd: s.aankomsttijd_slot,
      arrivalTime: s.arrivalTime,
      rit_nummer: i + 1,
      route_nummer: routeNummer,
      leg_nummer: Math.max(1, s.leg_nummer ?? 1),
    }));
  } catch (err) {
    console.warn(
      "[routific-slots] capaciteit-herberekening mislukt — fallback Routific-tijden",
      err
    );
    return buildPackedSlotsFromRoutificTimes(
      visits,
      orderByVisitId,
      routeNummer,
      capacity
    );
  }
}

/** Pack op capaciteit; behoud relatieve Routific-aankomstvolgorde en schuif tijden met depot-gap. */
function buildPackedSlotsFromRoutificTimes(
  visits: { order: OrderForRoute; arrivalMin: number }[],
  orderByVisitId: Map<string, OrderForRoute>,
  routeNummer: number | null,
  capacity: number
): BuiltRouteSlot[] {
  const routeStops: RouteStop[] = visits.map(({ order }) => ({
    id: order.id,
    volledig_adres: String(order.volledig_adres ?? "").trim(),
    bezorgtijd_voorkeur: order.bezorgtijd_voorkeur,
    load: orderRouteLoad(order),
  }));
  const legs = splitStopsBalancedByCapacity(routeStops, capacity);
  const arrivalById = new Map(visits.map((v) => [v.order.id, v.arrivalMin]));

  const out: BuiltRouteSlot[] = [];
  let prevFinishMin: number | null = null;

  for (let legIdx = 0; legIdx < legs.length; legIdx++) {
    const leg = legs[legIdx]!;
    const legNummer = legIdx + 1;
    let shift = 0;

    if (prevFinishMin != null && leg.length > 0) {
      const firstArrival = arrivalById.get(leg[0]!.id) ?? prevFinishMin;
      const earliestFirst = prevFinishMin + 25 + DEPOT_RELOAD_MINUTES + 25;
      if (firstArrival + shift < earliestFirst) {
        shift = earliestFirst - firstArrival;
      }
    }

    for (const stop of leg) {
      const order = orderByVisitId.get(stop.id) ?? visits.find((v) => v.order.id === stop.id)?.order;
      if (!order) continue;
      const base = arrivalById.get(stop.id) ?? 0;
      const arrivalMin = base + shift;
      const arrivalTime = fromMinutes(arrivalMin);
      out.push({
        order_id: order.id,
        arrivalTime,
        aankomsttijd: maakTijdslot(arrivalTime, order.bezorgtijd_voorkeur),
        rit_nummer: out.length + 1,
        route_nummer: routeNummer,
        leg_nummer: legNummer,
      });
      prevFinishMin = arrivalMin + SERVICE_TIME_MINUTES;
    }
  }

  return out.map((slot, i) => ({ ...slot, rit_nummer: i + 1 }));
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

/**
 * Waarschuwing als Routific meer load op een route zet dan de beschikbare capaciteit.
 * Bij "meerdere ritten" is de beschikbare capaciteit capaciteit × aantal ritten (legs),
 * niet de capaciteit van één enkele rit.
 */
export function getRouteCapacityWarnings(
  parallelRoutes: ParallelRouteSpec[],
  routeOrderLists: Map<number, string[]>,
  ordersById: Map<string, OrderForRoute>,
  legsPerRoute?: Map<number, number>
): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < parallelRoutes.length; i++) {
    const cap = Math.max(1, parallelRoutes[i]?.capacity ?? 99);
    const legs = legsPerRoute?.get(i + 1) ?? 1;
    const totalCap = cap * legs;
    const ids = routeOrderLists.get(i + 1) ?? [];
    const load = routeListLoad(ids, ordersById);
    if (load > totalCap) {
      warnings.push(
        `Route ${i + 1}: ${load} load-eenheden ingepland (max ${totalCap}${legs > 1 ? ` = ${legs} ritten × ${cap}` : ""}). Grote fietsen tellen dubbel.`
      );
    }
  }
  return warnings;
}

/**
 * Routelijsten per route uit Routific-oplossing, waarbij bij "meerdere ritten" de stops van
 * alle legs (vehicle_N, vehicle_N_leg2, ...) van diezelfde route worden samengevoegd.
 */
export function buildRouteOrderListsFromSolution(
  parallelRoutes: ParallelRouteSpec[],
  solution: Record<string, RoutificSolutionStop[]>,
  orderByVisitId: Map<string, OrderForRoute>,
  routeVehicleKeys?: Map<number, string[]>
): { lists: Map<number, string[]>; rawLists: Map<number, string[]> } {
  const lists = new Map<number, string[]>();
  const rawLists = new Map<number, string[]>();
  for (let i = 0; i < parallelRoutes.length; i++) {
    const keys = routeVehicleKeys?.get(i + 1) ?? [`vehicle_${i + 1}`];
    const ids = keys.flatMap((k) => extractOrderIdsFromRoutificStops(solution[k] ?? [], orderByVisitId));
    lists.set(i + 1, [...ids]);
    rawLists.set(i + 1, [...ids]);
  }
  return { lists, rawLists };
}

/** Verplaats handmatig gekozen orders naar hun route (behoud Routific-volgorde verder). */
export function enforcePinnedOrdersOnLists(
  routeOrderLists: Map<number, string[]>,
  parallelRoutes: ParallelRouteSpec[]
): boolean {
  const pinToRoute = new Map<string, number>();
  for (let i = 0; i < parallelRoutes.length; i++) {
    for (const id of parallelRoutes[i]?.orderIds ?? []) {
      pinToRoute.set(id, i + 1);
    }
  }
  if (pinToRoute.size === 0) return false;

  for (const list of Array.from(routeOrderLists.values())) {
    for (let j = list.length - 1; j >= 0; j--) {
      if (pinToRoute.has(list[j]!)) list.splice(j, 1);
    }
  }

  for (const [orderId, routeNum] of Array.from(pinToRoute.entries())) {
    const list = routeOrderLists.get(routeNum) ?? [];
    routeOrderLists.set(routeNum, list);
    if (!list.includes(orderId)) list.push(orderId);
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
