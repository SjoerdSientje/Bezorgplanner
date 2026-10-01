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

export type DutchAddressParts = {
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  weergavenaam: string;
};

export function normalizeAddressForRoutific(address: string): string {
  const s = address.trim();
  if (!s) return s;
  if (!/\b(netherlands|nederland)\b/i.test(s)) {
    return `${s}, Netherlands`;
  }
  return s;
}

/** Normaliseer NL-postcode naar `1234 AB`. */
export function formatPostcodeNl(raw: string | null | undefined): string {
  const p = String(raw ?? "")
    .replace(/\s/g, "")
    .toUpperCase();
  if (/^\d{4}[A-Z]{2}$/.test(p)) return `${p.slice(0, 4)} ${p.slice(4)}`;
  return String(raw ?? "").trim();
}

function isCompletePostcode(raw: string | null | undefined): boolean {
  return /^\d{4}[A-Z]{2}$/.test(String(raw ?? "").replace(/\s/g, "").toUpperCase());
}

/**
 * Vul ontbrekende adresdelen (vooral postcode) aan via PDOK.
 * Bestaande velden blijven staan; alleen lege/incomplete postcode wordt overschreven.
 */
export async function resolveDutchAddressParts(input: {
  straatnaam?: string;
  huisnummer?: string;
  postcode?: string;
  woonplaats?: string;
}): Promise<DutchAddressParts | null> {
  const straatIn = String(input.straatnaam ?? "").trim();
  const huisIn = String(input.huisnummer ?? "").trim();
  const postIn = formatPostcodeNl(input.postcode);
  const plaatsIn = String(input.woonplaats ?? "").trim();

  if (isCompletePostcode(postIn) && straatIn && huisIn && plaatsIn) {
    return {
      straatnaam: straatIn,
      huisnummer: huisIn,
      postcode: postIn,
      woonplaats: plaatsIn,
      weergavenaam: `${straatIn} ${huisIn}, ${postIn} ${plaatsIn}`,
    };
  }

  const q = [straatIn, huisIn, postIn, plaatsIn].filter(Boolean).join(" ").trim();
  if (q.length < 3) return null;

  try {
    const searchUrl = new URL(
      "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"
    );
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("fq", "type:adres");
    searchUrl.searchParams.set("rows", "1");
    searchUrl.searchParams.set(
      "fl",
      "id,weergavenaam,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam"
    );

    const searchRes = await fetch(searchUrl.toString(), { cache: "no-store" });
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as {
      response?: {
        docs?: Array<{
          id?: string;
          weergavenaam?: string;
          straatnaam?: string;
          huisnummer?: number | string;
          huisletter?: string;
          huisnummertoevoeging?: string;
          postcode?: string;
          woonplaatsnaam?: string;
        }>;
      };
    };
    let doc = searchData.response?.docs?.[0];
    if (!doc) return null;

    if (doc.id && !isCompletePostcode(doc.postcode)) {
      const lookupRes = await fetch(
        `https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=${encodeURIComponent(doc.id)}`,
        { cache: "no-store" }
      );
      if (lookupRes.ok) {
        const lookupData = (await lookupRes.json()) as {
          response?: { docs?: Array<Record<string, unknown>> };
        };
        const full = lookupData.response?.docs?.[0];
        if (full) doc = { ...doc, ...full };
      }
    }

    const num = String(doc.huisnummer ?? "").trim();
    const letter = String(doc.huisletter ?? "").trim();
    const toev = String(doc.huisnummertoevoeging ?? "").trim();
    const huisnummer = [num, letter, toev].filter(Boolean).join("") || huisIn;
    const postcode = formatPostcodeNl(doc.postcode) || postIn;
    const straatnaam = String(doc.straatnaam ?? "").trim() || straatIn;
    const woonplaats = String(doc.woonplaatsnaam ?? "").trim() || plaatsIn;
    const weergavenaam =
      String(doc.weergavenaam ?? "").trim() ||
      [straatnaam, huisnummer].filter(Boolean).join(" ") +
        (postcode || woonplaats
          ? `, ${[postcode, woonplaats].filter(Boolean).join(" ")}`
          : "");

    if (!isCompletePostcode(postcode) && !straatnaam) return null;

    return { straatnaam, huisnummer, postcode, woonplaats, weergavenaam };
  } catch {
    return null;
  }
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
