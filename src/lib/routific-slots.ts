/**
 * Tijdsloten uit Routific-oplossing: volgorde behouden + 20 min uitladen afdwingen.
 */

import { parseRoutificArrivalTime } from "@/lib/routific-arrival";
import { SERVICE_TIME_MINUTES, type OrderForRoute } from "@/lib/routific-payload";
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
