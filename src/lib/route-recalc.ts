/**
 * Herbereken aankomsttijden en tijdsloten langs een route (na handmatig herschikken).
 */

import { DEPOT_ADDRESS, SERVICE_TIME_MINUTES } from "@/lib/routific-payload";
import { parseBezorgtijdRestriction } from "@/lib/bezorgtijd-window";
import { maakTijdslot } from "@/lib/tijdslot";
import { getChainTravelMinutes } from "@/lib/google-travel-times";

/** Uitladen per stop (zelfde als Routific duration). */
export { SERVICE_TIME_MINUTES };

export type RouteStop = {
  id: string;
  volledig_adres: string;
  bezorgtijd_voorkeur: string | null;
};

export type RecalculatedStop = {
  id: string;
  arrivalTime: string;
  aankomsttijd_slot: string;
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function recalculateStopsFromLegMinutes(
  stops: RouteStop[],
  vertrektijd: string,
  legMinutes: number[]
): RecalculatedStop[] {
  if (stops.length === 0) return [];
  if (legMinutes.length !== stops.length) {
    throw new Error("Aantal etappes komt niet overeen met aantal stops.");
  }

  let current = toMinutes(vertrektijd);
  let prevFinishMin: number | null = null;
  const results: RecalculatedStop[] = [];

  for (let i = 0; i < stops.length; i++) {
    current += legMinutes[i]!;
    if (prevFinishMin != null && current < prevFinishMin) {
      current = prevFinishMin;
    }
    const arrivalTime = fromMinutes(current);
    const stop = stops[i]!;
    results.push({
      id: stop.id,
      arrivalTime,
      aankomsttijd_slot: maakTijdslot(arrivalTime, stop.bezorgtijd_voorkeur),
    });
    prevFinishMin = current + SERVICE_TIME_MINUTES;
    current = prevFinishMin;
  }

  return results;
}

function deadlineMinutes(bezorgtijd: string | null): number {
  const r = parseBezorgtijdRestriction(bezorgtijd);
  if (!r) return 24 * 60;
  if (r.kind === "voor") return toMinutes(r.maxEnd);
  if (r.kind === "tussen") return toMinutes(r.maxEnd);
  return 24 * 60;
}

/** Sorteer stops: strakke deadlines eerst, daarna rest (voor herberekening na pin-wijziging). */
export function sortStopsForTimedRoute(stops: RouteStop[]): RouteStop[] {
  return [...stops].sort(
    (a, b) => deadlineMinutes(a.bezorgtijd_voorkeur) - deadlineMinutes(b.bezorgtijd_voorkeur)
  );
}

/** Haal reistijden op via Google en bereken tijdsloten. */
export async function recalculateRouteStops(
  stops: RouteStop[],
  vertrektijd: string,
  depot = DEPOT_ADDRESS
): Promise<RecalculatedStop[]> {
  const ordered = sortStopsForTimedRoute(stops);
  const addresses = ordered.map((s) => String(s.volledig_adres ?? "").trim()).filter(Boolean);
  if (addresses.length !== ordered.length) {
    throw new Error("Eén of meer stops hebben geen volledig adres.");
  }
  const legMinutes = await getChainTravelMinutes(addresses, depot);
  return recalculateStopsFromLegMinutes(ordered, vertrektijd, legMinutes);
}
