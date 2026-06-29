/**
 * Bouwt de Routific API-payload uit gefilterde orders.
 * Geen ChatGPT: structuur en tijdvenster-parsing zijn hardcoded (minder foutgevoelig).
 */

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

export type Tijdvenster =
  | { start: string; end: string }
  | { start: string; end: null }; // end: null = "anytime after start" voor Routific

/**
 * Parsed "Bezorgtijd voorkeur" naar een tijdvenster in HH:MM.
 * - "na 15:00" / "pas na 16:00" → { start, end: null } (Routific: alleen start, geen end)
 * - "na 2" / "na 3" in **bezorgtijd voorkeur** (zonder minuten) → vaak middag: 14:00, 15:00 (uren 1–6 → +12)
 * - "tussen 12 en 17", "16:00 - 20:00" → { start, end }
 * Geen match → return null.
 */
export function parseBezorgtijdVoorkeur(
  text: string | null | undefined
): Tijdvenster | null {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw || raw === "geen") return null;

  // "na X" of "pas na X" → alleen start, geen end (Routific: "anytime after")
  const naMatch = raw.match(/\b(?:pas\s+)?na\s+(\d{1,2})(?::(\d{2}))?(?:\s*uur)?\b/i);
  if (naMatch) {
    let h = parseInt(naMatch[1], 10);
    const explicitMinutes = naMatch[2] != null;
    const m = explicitMinutes ? parseInt(naMatch[2]!, 10) : 0;
    // "na 2" zonder :mm: klanten bedoelen vrijwel altijd 14:00, niet 02:00 (zelfde voor 1–6).
    if (!explicitMinutes && h >= 1 && h <= 6) {
      h += 12;
    }
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return {
        start: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        end: null,
      };
    }
  }

  // "tussen 12 en 17" (alleen uren)
  const tussen = raw.match(/tussen\s*(\d{1,2})\s*en\s*(\d{1,2})/i);
  if (tussen) {
    const h1 = parseInt(tussen[1], 10);
    const h2 = parseInt(tussen[2], 10);
    if (h1 >= 0 && h1 <= 23 && h2 >= 0 && h2 <= 23) {
      return {
        start: `${String(h1).padStart(2, "0")}:00`,
        end: `${String(h2).padStart(2, "0")}:00`,
      };
    }
  }

  // Twee tijden: "16:00 - 20:00", "16:00 tot 20:00"
  const times: string[] = [];
  const hhmm = /\b(\d{1,2}):(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = hhmm.exec(raw)) !== null) {
    const hour = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      times.push(`${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
    }
  }
  if (times.length === 0) {
    const uurOnly = /\b(\d{1,2})\s*(?:uur|u\.?)\b/gi;
    while ((m = uurOnly.exec(raw)) !== null) {
      const hour = parseInt(m[1], 10);
      if (hour >= 0 && hour <= 23) times.push(`${String(hour).padStart(2, "0")}:00`);
    }
  }

  if (times.length >= 2) return { start: times[0], end: times[1] };
  if (times.length === 1) return { start: times[0], end: DEFAULT_SHIFT_END };
  return null;
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
  defaultStartForNoPreference: string,
  vehicleType?: string
): RoutificPayload["visits"][string] {
  const address = (o.volledig_adres || "").trim() || "Onbekend adres";
  const baseFietsen = Math.max(1, Number(o.aantal_fietsen) || 1);
  const unitSize = isGroteFiets(o.producten) ? 2 : 1;
  const load = baseFietsen * unitSize;
  const window = parseBezorgtijdVoorkeur(o.bezorgtijd_voorkeur);
  const start = window ? window.start : defaultStartForNoPreference;
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
  defaultStartForNoPreference: string
): RoutificPayload["visits"] {
  const visits: RoutificPayload["visits"] = {};
  for (const o of orders) {
    const visitId = sanitizeVisitId(o.id);
    visits[visitId] = buildVisitForOrder(o, defaultStartForNoPreference);
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
  const defaultStart = earliestParallelShiftStart(routes);
  const manualMode = routes.some((r) => (r.orderIds?.length ?? 0) > 0);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const assignedOrderIds = new Set(routes.flatMap((r) => r.orderIds ?? []));

  const visits: RoutificPayload["visits"] = {};
  if (manualMode) {
    routes.forEach((r, i) => {
      const vehicleType = `route_${i + 1}`;
      for (const orderId of r.orderIds ?? []) {
        const o = orderById.get(orderId);
        if (!o) continue;
        visits[sanitizeVisitId(o.id)] = buildVisitForOrder(o, defaultStart, vehicleType);
      }
    });
    for (const o of orders) {
      if (assignedOrderIds.has(o.id)) continue;
      visits[sanitizeVisitId(o.id)] = buildVisitForOrder(o, defaultStart);
    }
  } else {
    Object.assign(visits, buildVisits(orders, defaultStart));
  }

  const fleet: Record<string, VehicleConfig> = {};
  routes.forEach((r, i) => {
    const cap = Math.max(1, Math.min(99, Math.floor(Number(r.capacity) || 0)));
    const routeHasOrders = (r.orderIds?.length ?? 0) > 0;
    const vehicleType = manualMode && routeHasOrders ? `route_${i + 1}` : undefined;
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
