/**
 * Bouwt de Routific API-payload uit gefilterde orders.
 * Geen ChatGPT: structuur en tijdvenster-parsing zijn hardcoded (minder foutgevoelig).
 */

const DEPOT_ADDRESS = "Kapelweg 2, 3732 GS, De Bilt, Netherlands";
const DEFAULT_DURATION = 20;
const DEFAULT_SHIFT_END = "23:59";
const FLEET_CAPACITY_GROOT = 11;
const FLEET_CAPACITY_KLEIN = 4;
const RELOAD_TIME_KLEIN_MINUTEN = 30;

export interface OrderForRoute {
  id: string;
  naam: string | null;
  volledig_adres: string | null;
  aantal_fietsen: number | null;
  bezorgtijd_voorkeur: string | null;
}

export type Tijdvenster =
  | { start: string; end: string }
  | { start: string; end: null }; // end: null = "anytime after start" voor Routific

/**
 * Parsed "Bezorgtijd voorkeur" naar een tijdvenster in HH:MM.
 * - "na 15:00" / "pas na 16:00" → { start, end: null } (Routific: alleen start, geen end)
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
    const h = parseInt(naMatch[1], 10);
    const m = naMatch[2] != null ? parseInt(naMatch[2], 10) : 0;
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

export interface RoutificPayload {
  visits: Record<
    string,
    {
      location: { address: string };
      load: number;
      duration: number;
      start: string;
      end?: string; // weglaten = "anytime after start"
    }
  >;
  fleet: {
    vehicle_1: {
      start_location: { address: string };
      end_location: { address: string };
      shift_start: string;
      shift_end: string;
      capacity: number;
      strict_start: boolean;
      /** Herlaadtijd bij depotterugkeer (minuten) — alleen kleine bus */
      reload_service_time?: number;
    };
  };
}

/**
 * Bouwt de Routific-input uit orders en vertrektijd.
 * Visit-ID = order id (geen punten of $ vanwege Routific-eis).
 * busType "klein" = max 4 fietsen per lading (Routific plant retours naar depot);
 * busType "groot" = standaard capaciteit 11.
 */
export function buildRoutificPayload(
  orders: OrderForRoute[],
  vertrekTijd: string,
  busType: "klein" | "groot" = "groot"
): RoutificPayload {
  const capacity = busType === "klein" ? FLEET_CAPACITY_KLEIN : FLEET_CAPACITY_GROOT;
  const visits: RoutificPayload["visits"] = {};
  const sanitizeId = (id: string) => id.replace(/[.$]/g, "_");

  for (const o of orders) {
    const address = (o.volledig_adres || "").trim() || "Onbekend adres";
    const load = Math.max(1, Number(o.aantal_fietsen) || 1);
    const window = parseBezorgtijdVoorkeur(o.bezorgtijd_voorkeur);
    const start = window ? window.start : vertrekTijd;
    const end = window && window.end !== null ? window.end : DEFAULT_SHIFT_END;

    const visitId = sanitizeId(o.id);
    // Geen eindtijd opgegeven ("na X") → standaard 23:59
    visits[visitId] = {
      location: { address },
      load,
      duration: DEFAULT_DURATION,
      start,
      end,
    };
  }

  return {
    visits,
    fleet: {
      vehicle_1: {
        start_location: { address: DEPOT_ADDRESS },
        end_location: { address: DEPOT_ADDRESS },
        shift_start: vertrekTijd,
        shift_end: DEFAULT_SHIFT_END,
        capacity,
        strict_start: true,
        ...(busType === "klein" ? { reload_service_time: RELOAD_TIME_KLEIN_MINUTEN } : {}),
      },
    },
  };
}
