/**
 * Nederlandse adressen geocoderen via PDOK (gratis, geen Google).
 * Gebruikt vóór Routific zodat reistijden op juiste coördinaten zijn gebaseerd.
 */

import type { OrderForRoute } from "@/lib/routific-payload";

export type GeocodedAddress = {
  address: string;
  lat: number;
  lng: number;
};

export function normalizeAddressForRoutific(address: string): string {
  const s = address.trim();
  if (!s) return s;
  if (!/\b(netherlands|nederland)\b/i.test(s)) {
    return `${s}, Netherlands`;
  }
  return s;
}

function parseCentroideLl(centroide: string): { lat: number; lng: number } | null {
  const m = centroide.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const lng = parseFloat(m[1]!);
  const lat = parseFloat(m[2]!);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Geocode één Nederlands bezorgadres naar weergavenaam + WGS84-coördinaten. */
export async function geocodeDutchAddress(address: string): Promise<GeocodedAddress | null> {
  const q = address.trim();
  if (!q) return null;

  const searchUrl = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
  searchUrl.searchParams.set("q", q);
  searchUrl.searchParams.set("fq", "type:adres");
  searchUrl.searchParams.set("rows", "1");

  const searchRes = await fetch(searchUrl.toString(), { cache: "no-store" });
  if (!searchRes.ok) return null;

  const searchData = (await searchRes.json()) as {
    response?: { docs?: Array<{ id?: string; weergavenaam?: string }> };
  };
  const hit = searchData.response?.docs?.[0];
  if (!hit?.id) return null;

  const lookupRes = await fetch(
    `https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=${encodeURIComponent(hit.id)}`,
    { cache: "no-store" }
  );
  if (!lookupRes.ok) return null;

  const lookupData = (await lookupRes.json()) as {
    response?: { docs?: Array<{ weergavenaam?: string; centroide_ll?: string }> };
  };
  const doc = lookupData.response?.docs?.[0];
  const coords = doc?.centroide_ll ? parseCentroideLl(doc.centroide_ll) : null;
  if (!coords) return null;

  return {
    address: doc?.weergavenaam ?? hit.weergavenaam ?? q,
    lat: coords.lat,
    lng: coords.lng,
  };
}

/** Verrijk orders met PDOK-adres + coördinaten voor Routific. */
export async function geocodeOrdersForRouting(orders: OrderForRoute[]): Promise<OrderForRoute[]> {
  return Promise.all(
    orders.map(async (o) => {
      const raw = (o.volledig_adres || "").trim();
      if (!raw) return o;

      const normalized = normalizeAddressForRoutific(raw);
      const geo = await geocodeDutchAddress(normalized);
      if (!geo) {
        return { ...o, volledig_adres: normalized };
      }

      return {
        ...o,
        volledig_adres: geo.address,
        lat: geo.lat,
        lng: geo.lng,
      };
    })
  );
}
