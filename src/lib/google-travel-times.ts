/**
 * Reistijden via Google Distance Matrix API (server-side).
 */

import { DEPOT_ADDRESS } from "@/lib/routific-payload";

type DistanceMatrixResponse = {
  status: string;
  error_message?: string;
  rows?: {
    elements?: {
      status: string;
      duration?: { value: number };
    }[];
  }[];
};

/**
 * Berekent rijtijd in minuten per etappe: depot→stop₁, stop₁→stop₂, …
 * `addresses` = bezorgadressen in volgorde.
 */
export async function getChainTravelMinutes(
  addresses: string[],
  depot = DEPOT_ADDRESS
): Promise<number[]> {
  if (addresses.length === 0) return [];

  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY niet geconfigureerd. Voeg de sleutel toe in .env.local en Vercel."
    );
  }

  const origins = [depot, ...addresses.slice(0, -1)];
  const destinations = addresses;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origins.join("|"));
  url.searchParams.set("destinations", destinations.join("|"));
  url.searchParams.set("mode", "driving");
  url.searchParams.set("region", "nl");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = (await res.json()) as DistanceMatrixResponse;

  if (data.status !== "OK") {
    throw new Error(
      `Google Distance Matrix: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`
    );
  }

  const minutes: number[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const el = data.rows?.[i]?.elements?.[i];
    if (!el || el.status !== "OK" || !el.duration?.value) {
      const label = addresses[i] ?? `etappe ${i + 1}`;
      throw new Error(`Geen reistijd gevonden voor: ${label}`);
    }
    minutes.push(Math.max(1, Math.ceil(el.duration.value / 60)));
  }

  return minutes;
}
