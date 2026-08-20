/**
 * Herbereken aankomsttijden en tijdsloten langs een route (na handmatig herschikken).
 */

import {
  DEPOT_ADDRESS,
  DEPOT_RELOAD_MINUTES,
  SERVICE_TIME_MINUTES,
} from "@/lib/routific-payload";
import { parseBezorgtijdRestriction } from "@/lib/bezorgtijd-window";
import { maakTijdslot } from "@/lib/tijdslot";
import {
  getChainTravelMinutes,
  getPointToPointTravelMinutes,
} from "@/lib/google-travel-times";

/** Uitladen per stop (zelfde als Routific duration). */
export { SERVICE_TIME_MINUTES };

export type RouteStop = {
  id: string;
  volledig_adres: string;
  bezorgtijd_voorkeur: string | null;
  /** Load-eenheden (fietsen; grote fietsen kunnen 2 zijn). */
  load?: number;
};

export type RecalculatedStop = {
  id: string;
  arrivalTime: string;
  aankomsttijd_slot: string;
  leg_nummer?: number;
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

/** Eerste index waar de nieuwe volgorde afwijkt van de vorige (of lengte van de kortere lijst). */
export function firstOrderDivergenceIndex(
  previousOrderIds: string[],
  nextOrderIds: string[]
): number {
  const n = Math.min(previousOrderIds.length, nextOrderIds.length);
  for (let i = 0; i < n; i++) {
    if (previousOrderIds[i] !== nextOrderIds[i]) return i;
  }
  return n;
}

/** Start van een tijdslot "HH:MM - HH:MM" → genormaliseerde "HH:MM", of null. */
export function parseSlotArrivalHhmm(slot: string | null | undefined): string | null {
  const t = String(slot ?? "").split(" - ")[0]?.replace(".", ":").trim() ?? "";
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Vertrektijd vanaf een stop = aankomst + uitlaadtijd. */
export function departureAfterArrival(arrivalHhmm: string): string {
  return fromMinutes(toMinutes(arrivalHhmm) + SERVICE_TIME_MINUTES);
}

/**
 * Haal reistijden op via Google en bereken tijdsloten.
 * Behoudt de aangeleverde stopvolgorde (handmatig slepen/omwisselen).
 *
 * `fromAddress`: als gezet, is de eerste etappe fromAddress→stops[0] i.p.v. depot→stops[0]
 * (voor herberekening vanaf een ongewijzigde prefix van de route).
 */
export async function recalculateRouteStops(
  stops: RouteStop[],
  vertrektijd: string,
  options?: { depot?: string; fromAddress?: string }
): Promise<RecalculatedStop[]> {
  const addresses = stops.map((s) => String(s.volledig_adres ?? "").trim()).filter(Boolean);
  if (addresses.length !== stops.length) {
    throw new Error("Eén of meer stops hebben geen volledig adres.");
  }
  const startAddress = options?.fromAddress ?? options?.depot ?? DEPOT_ADDRESS;
  const legMinutes = await getChainTravelMinutes(addresses, startAddress);
  return recalculateStopsFromLegMinutes(stops, vertrektijd, legMinutes);
}

/** Splits stops in delen zodra voertuigcapaciteit vol is (voor terug naar depot). */
export function splitStopsByVehicleCapacity(
  stops: RouteStop[],
  capacity: number
): RouteStop[][] {
  const cap = Math.max(1, Math.floor(Number(capacity) || 1));
  const legs: RouteStop[][] = [];
  let current: RouteStop[] = [];
  let load = 0;
  for (const s of stops) {
    const l = Math.max(1, Math.floor(Number(s.load ?? 1)));
    if (current.length > 0 && load + l > cap) {
      legs.push(current);
      current = [];
      load = 0;
    }
    current.push(s);
    load += l;
  }
  if (current.length > 0) legs.push(current);
  return legs;
}

function stopLoad(s: RouteStop): number {
  return Math.max(1, Math.floor(Number(s.load ?? 1)));
}

export function totalRouteStopLoad(stops: RouteStop[]): number {
  return stops.reduce((sum, s) => sum + stopLoad(s), 0);
}

/**
 * Verdeel stops over precies ceil(load/cap) ritten, zo gelijk mogelijk,
 * zonder capaciteit te overschrijden. Bij 9 load / max 4 → mik op 3+3+3 i.p.v. 4+4+1.
 */
export function splitStopsBalancedByCapacity(
  stops: RouteStop[],
  capacity: number
): RouteStop[][] {
  const cap = Math.max(1, Math.floor(Number(capacity) || 1));
  if (stops.length === 0) return [];
  const total = totalRouteStopLoad(stops);
  const minLegs = Math.max(1, Math.ceil(total / cap));
  if (minLegs <= 1) return [stops];

  const legs: RouteStop[][] = [];
  let idx = 0;

  for (let leg = 0; leg < minLegs; leg++) {
    const legsLeft = minLegs - leg;
    const remaining = stops.slice(idx);
    const remLoad = totalRouteStopLoad(remaining);
    const target = Math.ceil(remLoad / legsLeft);
    const current: RouteStop[] = [];
    let load = 0;

    while (idx < stops.length) {
      const s = stops[idx]!;
      const l = stopLoad(s);
      if (current.length > 0 && load + l > cap) break;

      if (current.length > 0 && load >= target && leg < minLegs - 1) {
        const loadAfter = remLoad - load;
        if (loadAfter <= (legsLeft - 1) * cap) break;
      }

      current.push(s);
      load += l;
      idx++;
      if (load >= cap) break;
    }

    if (current.length === 0 && idx < stops.length) {
      // Enkele stop groter dan restcapaciteit-logica: forceer toch door (cap-check eerder).
      current.push(stops[idx]!);
      idx++;
    }
    if (current.length > 0) legs.push(current);
  }

  while (idx < stops.length) {
    const s = stops[idx]!;
    const l = stopLoad(s);
    const last = legs[legs.length - 1];
    if (last && totalRouteStopLoad(last) + l <= cap) {
      last.push(s);
    } else {
      legs.push([s]);
    }
    idx++;
  }

  return legs;
}

function legsFingerprint(legs: RouteStop[][]): string {
  return legs.map((leg) => leg.map((s) => s.id).join(",")).join("|");
}

async function scoreLegsTotalTravelMinutes(
  legs: RouteStop[][],
  depot: string
): Promise<number> {
  let total = 0;
  for (const leg of legs) {
    if (leg.length === 0) continue;
    const addresses = leg.map((s) => String(s.volledig_adres ?? "").trim());
    if (addresses.some((a) => !a)) throw new Error("Adres ontbreekt bij score");
    const chain = await getChainTravelMinutes(addresses, depot);
    total += chain.reduce((sum, m) => sum + m, 0);
    total += await getPointToPointTravelMinutes(addresses[addresses.length - 1]!, depot);
  }
  return total;
}

/**
 * Kies de beste verdeling in precies het minimale aantal ritten:
 * - pack-full (4+4+1)
 * - balanced (3+3+3)
 * - eventueel Routific-verdeling (als die al minimaal #ritten heeft en binnen capaciteit past)
 * Score = totale rijtijd incl. terug naar depot.
 */
export async function chooseBestCapacityLegs(
  stops: RouteStop[],
  capacity: number,
  options?: { depot?: string; routificLegs?: RouteStop[][] }
): Promise<RouteStop[][]> {
  const depot = options?.depot ?? DEPOT_ADDRESS;
  const cap = Math.max(1, Math.floor(Number(capacity) || 1));
  if (stops.length === 0) return [];

  const minLegs = Math.max(1, Math.ceil(totalRouteStopLoad(stops) / cap));
  const candidates: { name: string; legs: RouteStop[][] }[] = [
    { name: "pack_full", legs: splitStopsByVehicleCapacity(stops, cap) },
    { name: "balanced", legs: splitStopsBalancedByCapacity(stops, cap) },
  ];

  const rf = options?.routificLegs;
  if (rf && rf.length > 0) {
    const flatIds = new Set(rf.flatMap((leg) => leg.map((s) => s.id)));
    const valid =
      rf.length === minLegs &&
      flatIds.size === stops.length &&
      stops.every((s) => flatIds.has(s.id)) &&
      rf.every((leg) => totalRouteStopLoad(leg) <= cap);
    if (valid) candidates.push({ name: "routific", legs: rf });
  }

  const unique: { name: string; legs: RouteStop[][] }[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const fp = legsFingerprint(c.legs);
    if (seen.has(fp)) continue;
    seen.add(fp);
    unique.push(c);
  }

  if (unique.length === 1) return unique[0]!.legs;

  let best = unique[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of unique) {
    try {
      const score = await scoreLegsTotalTravelMinutes(c.legs, depot);
      console.info(
        "[route-recalc] depot-legs kandidaat",
        c.name,
        c.legs.map((leg) => `${leg.length}st/${totalRouteStopLoad(leg)}load`).join(" + "),
        `→ ${score} min`
      );
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    } catch (err) {
      console.warn("[route-recalc] score mislukt voor", c.name, err);
    }
  }

  console.info(
    "[route-recalc] depot-legs gekozen",
    best.name,
    best.legs.map((leg) => `${leg.length}st`).join(" + ")
  );
  return best.legs;
}

/**
 * Herberekent een route met terug naar depot + herladen tussen capaciteitsdelen.
 * Kiest tussen volle bus, gebalanceerde ritten, en (optioneel) Routific-split op rijtijd.
 */
export async function recalculateRouteStopsWithDepotReturns(
  stops: RouteStop[],
  vertrektijd: string,
  capacity: number,
  options?: { depot?: string; routificLegs?: RouteStop[][] }
): Promise<RecalculatedStop[]> {
  const depot = options?.depot ?? DEPOT_ADDRESS;
  const legs = await chooseBestCapacityLegs(stops, capacity, {
    depot,
    routificLegs: options?.routificLegs,
  });
  if (legs.length <= 1) {
    const single = await recalculateRouteStops(stops, vertrektijd, { depot });
    return single.map((s) => ({ ...s, leg_nummer: 1 }));
  }

  const out: RecalculatedStop[] = [];
  let nextDepart = vertrektijd;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const calc = await recalculateRouteStops(leg, nextDepart, { depot });
    for (const s of calc) {
      out.push({ ...s, leg_nummer: i + 1 });
    }
    if (i < legs.length - 1) {
      const last = calc[calc.length - 1]!;
      const lastAddr = String(leg[leg.length - 1]?.volledig_adres ?? "").trim();
      let toDepot = 25;
      try {
        toDepot = await getPointToPointTravelMinutes(lastAddr, depot);
      } catch {
        // fallback schatting
      }
      nextDepart = fromMinutes(
        toMinutes(last.arrivalTime) + SERVICE_TIME_MINUTES + toDepot + DEPOT_RELOAD_MINUTES
      );
    }
  }

  return out;
}
