/**
 * Bouwt de Routific API-payload uit gefilterde orders.
 * Geen ChatGPT: structuur en tijdvenster-parsing zijn hardcoded (minder foutgevoelig).
 */

import { parseBezorgtijdVoorkeur } from "@/lib/bezorgtijd-window";

export const DEPOT_ADDRESS = "Kapelweg 2, 3732 GS, De Bilt, Netherlands";
/** Uitladen per bezorgstop (minuten) — Routific duration + tijd tussen stops. */
export const SERVICE_TIME_MINUTES = 20;
const DEFAULT_DURATION = SERVICE_TIME_MINUTES;
const DEFAULT_SHIFT_END = "23:59";
/** Minuten op het depot tussen twee ritten; stelt Routific in staat meerdere laadrondes te plannen. */
const RELOAD_TIME_MINUTEN = 30;

export interface OrderForRoute {
  id: string;
  naam: string | null;
  volledig_adres: string | null;
  aantal_fietsen: number | null;
  bezorgtijd_voorkeur: string | null;
  producten: string | null;
  /** PDOK-coördinaten voor Routific (nauwkeurigere reistijden). */
  lat?: number | null;
  lng?: number | null;
}

/** GT2000, Engwe E26 en Qibbel/family/kinderzitje zijn breder/groter; bij max. load ≤ 4 tellen alle fietsen dubbel qua load. */
const GROTE_FIETS_PATTERNS = [
  /gt\s*2000/i,
  /engwe\s*e26/i,
  /qibbel/i,
  /family/i,
  /kinderzitje/i,
];

function isGroteFiets(producten: string | null | undefined): boolean {
  const text = String(producten ?? "");
  return GROTE_FIETS_PATTERNS.some((p) => p.test(text));
}

/** Load-eenheden per order (zelfde berekening als Routific visits). */
export function orderRouteLoad(o: OrderForRoute): number {
  const baseFietsen = Math.max(1, Number(o.aantal_fietsen) || 1);
  const unitSize = isGroteFiets(o.producten) ? 2 : 1;
  return baseFietsen * unitSize;
}

type RoutificLocation = { address: string; lat?: number; lng?: number };

type VehicleConfig = {
  start_location: RoutificLocation;
  end_location: RoutificLocation;
  shift_start: string;
  shift_end: string;
  capacity: number;
  strict_start: boolean;
  /** Routific: alleen visits met dezelfde type mogen op dit voertuig. */
  type?: string;
  /** Minuten laden op het depot na terugkomst; weglaten = geen depot-reload (één rit). */
  reload_service_time?: number;
};

export interface RoutificPayload {
  visits: Record<
    string,
    {
      location: RoutificLocation;
      load: number;
      duration: number;
      start: string;
      end?: string;
      type?: string;
    }
  >;
  fleet: Record<string, VehicleConfig>;
}

export type ParallelRouteSpec = {
  /** HH:MM — vertrek vanaf depot voor dit voertuig */
  shift_start: string;
  /** Max. fietsen tegelijk (VRP-capaciteit) per rit */
  capacity: number;
  /**
   * true  → voertuig mag terug naar depot als vol en meerdere ritten rijden.
   * false → één rit, geen depot-return.
   */
  meerdereRitten?: boolean;
  /** Handmatig gekozen orders voor deze route (Routific type-koppeling). */
  orderIds?: string[];
};

function sanitizeVisitId(id: string): string {
  return id.replace(/[.$]/g, "_");
}

function buildLocation(address: string, lat?: number | null, lng?: number | null): RoutificLocation {
  const loc: RoutificLocation = { address };
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    loc.lat = lat;
    loc.lng = lng;
  }
  return loc;
}

function buildVisitForOrder(
  o: OrderForRoute,
  shiftStart: string,
  vehicleType?: string
): RoutificPayload["visits"][string] {
  const address = (o.volledig_adres || "").trim() || "Onbekend adres";
  const load = orderRouteLoad(o);
  const window = parseBezorgtijdVoorkeur(o.bezorgtijd_voorkeur, shiftStart);
  const start = window ? window.start : shiftStart;
  const end = window && window.end !== null ? window.end : DEFAULT_SHIFT_END;

  return {
    location: buildLocation(address, o.lat, o.lng),
    load,
    duration: DEFAULT_DURATION,
    start,
    end,
    ...(vehicleType ? { type: vehicleType } : {}),
  };
}

function buildVisits(
  orders: OrderForRoute[],
  routes: ParallelRouteSpec[],
  pinToRouteType: Map<string, string>
): RoutificPayload["visits"] {
  const defaultStart = earliestParallelShiftStart(routes);
  const visits: RoutificPayload["visits"] = {};
  for (const o of orders) {
    const visitId = sanitizeVisitId(o.id);
    const vehicleType = pinToRouteType.get(o.id);
    visits[visitId] = buildVisitForOrder(o, defaultStart, vehicleType);
  }
  return visits;
}

function minutesFromHHMM(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 24 * 60;
  return h * 60 + m;
}

/** Vroegste shift voor bezoeken zonder klantvoorkeur (start/end venster). */
export function earliestParallelShiftStart(routes: ParallelRouteSpec[]): string {
  if (routes.length === 0) return "10:30";
  let best = routes[0].shift_start;
  let bestM = minutesFromHHMM(best);
  for (const r of routes) {
    const mm = minutesFromHHMM(r.shift_start);
    if (mm < bestM) {
      bestM = mm;
      best = r.shift_start;
    }
  }
  return best;
}

/** Bepaalt hoe handmatige adreskeuze wordt toegepast op de Routific-payload. */
export type RouteAssignmentMode = "auto" | "fullManual" | "partialManual";

export function getRouteAssignmentMode(
  routes: ParallelRouteSpec[],
  orderCount: number
): RouteAssignmentMode {
  const pinned = routes.flatMap((r) => r.orderIds ?? []);
  if (pinned.length === 0) return "auto";
  if (pinned.length >= orderCount) return "fullManual";
  return "partialManual";
}

/**
 * Bouwt fleet + visits: één of meer routes, elk met eigen vertrektijd en max. load (fietsen).
 * Routific verdeelt stops om reistijd te minimaliseren binnen die capaciteiten.
 */
export function buildRoutificPayloadFromRoutes(
  orders: OrderForRoute[],
  routes: ParallelRouteSpec[]
): RoutificPayload {
  if (routes.length === 0) {
    throw new Error("Minimaal één route nodig.");
  }

  // Handmatig gekozen orders (Kies adressen) worden via Routific's `type`-koppeling
  // hard vastgezet op hún route: alléén die route's voertuig mag de visit serveren.
  // Niet-gekozen orders krijgen geen type, dus die blijven vrij verdeelbaar over alle
  // voertuigen (incl. voertuigen met pins) — Routific vult de resterende capaciteit
  // dan zelf optimaal, zónder dat een pin de capaciteitslimiet van zijn route omzeilt.
  const pinToRouteType = new Map<string, string>();
  routes.forEach((r, i) => {
    for (const orderId of r.orderIds ?? []) {
      pinToRouteType.set(orderId, `route_${i + 1}`);
    }
  });

  const visits = buildVisits(orders, routes, pinToRouteType);

  const fleet: Record<string, VehicleConfig> = {};
  routes.forEach((r, i) => {
    const cap = Math.max(1, Math.min(99, Math.floor(Number(r.capacity) || 0)));
    const vehicleType = (r.orderIds?.length ?? 0) > 0 ? `route_${i + 1}` : undefined;
    fleet[`vehicle_${i + 1}`] = {
      start_location: { address: DEPOT_ADDRESS },
      end_location: { address: DEPOT_ADDRESS },
      shift_start: r.shift_start,
      shift_end: DEFAULT_SHIFT_END,
      capacity: cap,
      strict_start: true,
      ...(vehicleType ? { type: vehicleType } : {}),
      ...(r.meerdereRitten ? { reload_service_time: RELOAD_TIME_MINUTEN } : {}),
    };
  });

  return { visits, fleet };
}

/** @deprecated gebruik buildRoutificPayloadFromRoutes — alias voor bestaande imports */
export const buildRoutificPayloadParallel = buildRoutificPayloadFromRoutes;
