/**
 * Tijdsloten uit Routific-oplossing: stopvolgorde behouden + 20 min uitladen afdwingen.
 * Bij meerdere ritten: na elk deel terug naar depot + herladen meenemen in de tijden.
 */

import { parseRoutificArrivalTime } from "@/lib/routific-arrival";
import { getPointToPointTravelMinutes } from "@/lib/google-travel-times";
import {
  DEPOT_ADDRESS,
  DEPOT_RELOAD_MINUTES,
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
 * Tussen delen: rijtijd laatste stop → depot + DEPOT_RELOAD_MINUTES + rijtijd depot → eerste stop deel 2.
 * (Routific plant legs als losse voertuigen die parallel mogen lopen; zonder deze stap
 * plakken stops aan elkaar met alleen 20 min uitladen.)
 */
export async function buildRouteSlotsFromMultiLegSolution(
  legStopsList: RoutificSolutionStop[][],
  orderByVisitId: Map<string, OrderForRoute>,
  routeNummer: number | null
): Promise<BuiltRouteSlot[]> {
  const nonEmptyLegs = legStopsList.filter((stops) =>
    stops.some((s) => {
      const locId = s.location_id ?? "";
      return !isDepotLikeStop(locId) && orderByVisitId.has(locId);
    })
  );

  if (nonEmptyLegs.length <= 1) {
    return buildRouteSlotsFromRoutificStops(nonEmptyLegs[0] ?? [], orderByVisitId, routeNummer, {
      legNummer: 1,
    });
  }

  const out: BuiltRouteSlot[] = [];
  let prevFinishMin: number | null = null;
  let prevAddress: string | null = null;
  let ritOffset = 0;

  for (let legIdx = 0; legIdx < nonEmptyLegs.length; legIdx++) {
    const legNummer = legIdx + 1;
    let legSlots = buildRouteSlotsFromRoutificStops(
      nonEmptyLegs[legIdx]!,
      orderByVisitId,
      routeNummer,
      { legNummer, ritNummerOffset: ritOffset }
    );
    if (legSlots.length === 0) continue;

    if (prevFinishMin != null && prevAddress) {
      const firstOrder = orderByVisitId.get(legSlots[0]!.order_id);
      const firstAddress = String(firstOrder?.volledig_adres ?? "").trim();
      let shift = 0;
      if (firstAddress) {
        try {
          const toDepot = await getPointToPointTravelMinutes(prevAddress, DEPOT_ADDRESS);
          const fromDepot = await getPointToPointTravelMinutes(DEPOT_ADDRESS, firstAddress);
          const earliestFirst =
            prevFinishMin + toDepot + DEPOT_RELOAD_MINUTES + fromDepot;
          const firstArrival = toMinutes(legSlots[0]!.arrivalTime);
          if (firstArrival < earliestFirst) {
            shift = earliestFirst - firstArrival;
          }
        } catch (err) {
          console.warn(
            "[routific-slots] depot-reistijd mislukt — schatting 25+30+25 min",
            err
          );
          const earliestFirst = prevFinishMin + 25 + DEPOT_RELOAD_MINUTES + 25;
          const firstArrival = toMinutes(legSlots[0]!.arrivalTime);
          if (firstArrival < earliestFirst) {
            shift = earliestFirst - firstArrival;
          }
        }
      }

      if (shift > 0) {
        legSlots = legSlots.map((slot) => {
          const order = orderByVisitId.get(slot.order_id);
          const arrivalMin = toMinutes(slot.arrivalTime) + shift;
          const arrivalTime = fromMinutes(arrivalMin);
          return {
            ...slot,
            arrivalTime,
            aankomsttijd: maakTijdslot(
              arrivalTime,
              order?.bezorgtijd_voorkeur ?? null
            ),
          };
        });
      }
    }

    for (const slot of legSlots) {
      out.push(slot);
      prevFinishMin = toMinutes(slot.arrivalTime) + SERVICE_TIME_MINUTES;
      const addr = String(orderByVisitId.get(slot.order_id)?.volledig_adres ?? "").trim();
      if (addr) prevAddress = addr;
    }
    ritOffset = out.length;
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
