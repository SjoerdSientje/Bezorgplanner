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

async function fetchDistanceMatrix(
  origins: string[],
  destinations: string[]
): Promise<DistanceMatrixResponse> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY niet geconfigureerd. Voeg de sleutel toe in .env.local en Vercel."
    );
  }

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origins.join("|"));
  url.searchParams.set("destinations", destinations.join("|"));
  url.searchParams.set("mode", "driving");
  url.searchParams.set("region", "nl");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString(), { cache: "no-store" });
  return (await res.json()) as DistanceMatrixResponse;
}

/**
 * Berekent rijtijd in minuten per etappe: start→stop₁, stop₁→stop₂, …
 * `addresses` = bezorgadressen in volgorde.
 * `startAddress` = vertrekpunt van de eerste etappe (standaard: depot).
 */
export async function getChainTravelMinutes(
  addresses: string[],
  startAddress = DEPOT_ADDRESS
): Promise<number[]> {
  if (addresses.length === 0) return [];

  const origins = [startAddress, ...addresses.slice(0, -1)];
  const destinations = addresses;

  const data = await fetchDistanceMatrix(origins, destinations);

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

/** Enkele etappe A→B in minuten (rijden). */
export async function getPointToPointTravelMinutes(
  fromAddress: string,
  toAddress: string
): Promise<number> {
  const from = String(fromAddress ?? "").trim();
  const to = String(toAddress ?? "").trim();
  if (!from || !to) {
    throw new Error("Van- en naar-adres verplicht voor reistijd.");
  }
  if (from.toLowerCase() === to.toLowerCase()) return 1;

  const data = await fetchDistanceMatrix([from], [to]);
  if (data.status !== "OK") {
    throw new Error(
      `Google Distance Matrix: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`
    );
  }
  const el = data.rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK" || !el.duration?.value) {
    throw new Error(`Geen reistijd gevonden voor: ${from} → ${to}`);
  }
  return Math.max(1, Math.ceil(el.duration.value / 60));
}
