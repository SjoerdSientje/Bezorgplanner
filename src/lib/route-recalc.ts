/**
 * Herbereken aankomsttijden en tijdsloten langs een route (na handmatig herschikken).
 */

import { DEPOT_ADDRESS, SERVICE_TIME_MINUTES } from "@/lib/routific-payload";
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
  const results: RecalculatedStop[] = [];

  for (let i = 0; i < stops.length; i++) {
    current += legMinutes[i]!;
    const arrivalTime = fromMinutes(current);
    const stop = stops[i]!;
    results.push({
      id: stop.id,
      arrivalTime,
      aankomsttijd_slot: maakTijdslot(arrivalTime, stop.bezorgtijd_voorkeur),
    });
    current += SERVICE_TIME_MINUTES;
  }

  return results;
}

/** Haal reistijden op via Google en bereken tijdsloten. */
export async function recalculateRouteStops(
  stops: RouteStop[],
  vertrektijd: string,
  depot = DEPOT_ADDRESS
): Promise<RecalculatedStop[]> {
  const addresses = stops.map((s) => String(s.volledig_adres ?? "").trim()).filter(Boolean);
  if (addresses.length !== stops.length) {
    throw new Error("Eén of meer stops hebben geen volledig adres.");
  }
  const legMinutes = await getChainTravelMinutes(addresses, depot);
  return recalculateStopsFromLegMinutes(stops, vertrektijd, legMinutes);
}
