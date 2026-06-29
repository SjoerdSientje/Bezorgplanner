/** localStorage-key voor route-instellingen (zelfde als Route genereren-dialoog). */
export const ROUTES_LS = "bezorgplanner.routes.v3";

export type SavedRouteRow = {
  vertrektijd: string;
  maxFietsen: number;
  meerdereRitten: boolean;
  orderIds: string[];
};

const FALLBACK_VERTREKTIJD = "10:30";

function parseSavedRoutes(raw: string | null): SavedRouteRow[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p) || p.length === 0) return [];
    const rows: SavedRouteRow[] = [];
    for (const x of p) {
      const o = x as Record<string, unknown>;
      const vt = String(o.vertrektijd ?? "").trim();
      const mf =
        typeof o.maxFietsen === "number"
          ? o.maxFietsen
          : parseInt(String(o.maxFietsen ?? "11"), 10);
      const mr = Boolean(o.meerdereRitten ?? false);
      const orderIds = Array.isArray(o.orderIds)
        ? o.orderIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
      if (/^\d{1,2}:\d{2}$/.test(vt) && Number.isFinite(mf) && mf >= 1 && mf <= 99) {
        rows.push({ vertrektijd: vt, maxFietsen: mf, meerdereRitten: mr, orderIds });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export function readSavedRoutesFromStorage(): SavedRouteRow[] {
  if (typeof window === "undefined") return [];
  const raw =
    localStorage.getItem(ROUTES_LS) ?? localStorage.getItem("bezorgplanner.routes.v2");
  return parseSavedRoutes(raw);
}

export function defaultRouteRowsForDialog(): SavedRouteRow[] {
  return [{ vertrektijd: FALLBACK_VERTREKTIJD, maxFietsen: 11, meerdereRitten: false, orderIds: [] }];
}

/** Route-nummer (1, 2, …) → vertrektijd uit Route genereren-dialoog. */
export function loadRouteVertrektijden(): Record<number, string> {
  const map: Record<number, string> = {};
  readSavedRoutesFromStorage().forEach((row, i) => {
    map[i + 1] = row.vertrektijd;
  });
  return map;
}

export function getVertrektijdForRoute(routeNummer: number): string | null {
  const map = loadRouteVertrektijden();
  const vt = map[routeNummer];
  return vt && /^\d{1,2}:\d{2}$/.test(vt) ? vt : null;
}

/** Contexttekst voor Sientje (alle routes uit het dialoog). */
export function formatRouteVertrektijdenContext(): string {
  const rows = readSavedRoutesFromStorage();
  if (rows.length === 0) return "Geen route-instellingen opgeslagen.";
  return rows
    .map((r, i) => `Route ${i + 1}: vertrek ${r.vertrektijd} (max. ${r.maxFietsen} fietsen)`)
    .join("; ");
}
