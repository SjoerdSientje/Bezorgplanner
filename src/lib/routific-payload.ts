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
/** Minuten op het depot tussen twee ritten (laden/lossen); gebruikt om de vertrektijd van
 * een volgende rit te schatten bij "meerdere ritten". */
const RELOAD_TIME_MINUTEN = 30;
/** Ruwe schatting gemiddelde reistijd tussen twee opeenvolgende stops (minuten), alleen
 * gebruikt om de vertrektijd van rit 2/3/... te schatten. Routific bepaalt de daadwerkelijke
 * aankomsttijden zelf op basis van de echte reisafstanden — deze schatting is enkel een
 * ondergrens zodat rit 2 niet vóór het (geschatte) einde van rit 1 kan beginnen. */
const ESTIMATED_TRAVEL_MINUTES_PER_STOP = 10;
/** Maximaal aantal ritten (legs) per voertuig per dag bij "meerdere ritten" — redelijke bovengrens. */
const MAX_LEGS_PER_ROUTE = 6;

/**
 * Routific ondersteunt geen automatische "terug naar depot, herladen, doorgaan" binnen één
 * voertuig/rit — een voertuig is voor Routific één ononderbroken rit (zie Routific-docs:
 * "you must define a separate driver object for each trip... that start and end at the
 * depot"). Om "meerdere ritten" tóch te ondersteunen, modelleren we een route met
 * `meerdereRitten: true` als meerdere voertuigen ("legs") die alle op hetzelfde depot
 * starten/eindigen en (bij handmatige adreskeuze) hetzelfde `type` krijgen, zodat Routific
 * ze samen als één logische route mag vullen. Rit 2, 3, ... krijgen een geschatte vertrektijd
 * (rit 1 se vertrektijd + capaciteit × gem. stoptijd + herlaadtijd) en `strict_start: false`,
 * zodat Routific ze niet vóór die schatting laat vertrekken maar wel later mag laten starten
 * als de werkelijke reistijden dat vereisen.
 */
function estimateLegDurationMinutes(capacity: number): number {
  return capacity * (SERVICE_TIME_MINUTES + ESTIMATED_TRAVEL_MINUTES_PER_STOP) + RELOAD_TIME_MINUTEN;
}

function addMinutesToTime(hhmm: string, minutes: number): string {
  const base = minutesFromHHMM(hhmm);
  const total = Math.min(base + minutes, minutesFromHHMM(DEFAULT_SHIFT_END));
  const clamped = Math.max(0, total);
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Aantal ritten (legs) dat een route met "meerdere ritten" nodig heeft: de totale load van
 * de orders die op deze route kunnen landen, gedeeld door de capaciteit per rit.
 * - Handmatig gekozen adressen (orderIds) → alleen die orders tellen mee.
 * - Anders (auto/deels handmatig) → alle orders die niet aan een ándere route gepind zijn
 *   (die kunnen in theorie allemaal op deze route belanden).
 */
export function estimateLegsForRoute(
  routeIndex: number,
  routes: ParallelRouteSpec[],
  orders: OrderForRoute[]
): number {
  const route = routes[routeIndex];
  if (!route?.meerdereRitten) return 1;
  const cap = Math.max(1, Math.min(99, Math.floor(Number(route.capacity) || 0)));
  const pinnedIds = new Set(route.orderIds ?? []);
  let candidateOrders: OrderForRoute[];
  if (pinnedIds.size > 0) {
    candidateOrders = orders.filter((o) => pinnedIds.has(o.id));
  } else {
    const otherPinnedIds = new Set(
      routes.flatMap((r, i) => (i === routeIndex ? [] : r.orderIds ?? []))
    );
    candidateOrders = orders.filter((o) => !otherPinnedIds.has(o.id));
  }
  const totalLoad = candidateOrders.reduce((sum, o) => sum + orderRouteLoad(o), 0);
  const legs = Math.ceil(totalLoad / cap);
  return Math.max(1, Math.min(MAX_LEGS_PER_ROUTE, legs));
}

/** Voertuig-keys (fleet) voor alle legs/ritten van één route, in ritvolgorde. */
export function getRouteLegVehicleKeys(routeIndex: number, legs: number): string[] {
  const keys: string[] = [];
  for (let leg = 1; leg <= legs; leg++) {
    keys.push(leg === 1 ? `vehicle_${routeIndex + 1}` : `vehicle_${routeIndex + 1}_leg${leg}`);
  }
  return keys;
}

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

/**
 * Load-eenheden per order (zelfde berekening als Routific visits).
 * aantal_fietsen = 0 is bewust (bv. "Reparatie aan huis": geen fiets mee in de bus) en
 * telt dus als 0 load — alleen ontbrekende waarde (null/undefined) valt terug op 1.
 */
export function orderRouteLoad(o: OrderForRoute): number {
  const raw = o.aantal_fietsen;
  const baseFietsen = raw == null || !Number.isFinite(Number(raw)) ? 1 : Math.max(0, Number(raw));
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
    const legs = r.meerdereRitten ? estimateLegsForRoute(i, routes, orders) : 1;
    const legDuration = estimateLegDurationMinutes(cap);
    const keys = getRouteLegVehicleKeys(i, legs);
    keys.forEach((key, idx) => {
      const leg = idx + 1;
      const shiftStart =
        leg === 1 ? r.shift_start : addMinutesToTime(r.shift_start, (leg - 1) * legDuration);
      fleet[key] = {
        start_location: { address: DEPOT_ADDRESS },
        end_location: { address: DEPOT_ADDRESS },
        shift_start: shiftStart,
        shift_end: DEFAULT_SHIFT_END,
        capacity: cap,
        // Alleen rit 1 moet exact op de gekozen vertrektijd starten; latere ritten mogen
        // (moeten desnoods) later starten dan de schatting, nooit eerder.
        strict_start: leg === 1,
        ...(vehicleType ? { type: vehicleType } : {}),
      };
    });
  });

  return { visits, fleet };
}

/** @deprecated gebruik buildRoutificPayloadFromRoutes — alias voor bestaande imports */
export const buildRoutificPayloadParallel = buildRoutificPayloadFromRoutes;
