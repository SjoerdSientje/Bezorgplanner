import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Maak een Supabase server-client die Next.js fetch-caching omzeilt.
 * Next.js 14 cachet intern alle fetch()-aanroepen; door cache:'no-store'
 * door te geven aan de Supabase-client zien alle queries altijd live data.
 */
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

/**
 * Haalt ALLE orders op via directe REST-aanroep, met paginering.
 * PostgREST geeft standaard max. 1000 rijen per call terug (db-max-rows), ook bij een
 * "kale" fetch met de service-role key — dat omzeilt de limiet dus NIET. Bij >1000 orders
 * in de tabel werden hierdoor eerder stilzwijgend rijen buiten de eerste 1000 genegeerd.
 * Gebruik bij voorkeur een serverside WHERE-filter (kleinere resultset) i.p.v. deze
 * functie; dit is een fallback voor de zeldzame gevallen waarin echt alles nodig is.
 */
export async function fetchAllOrders(): Promise<Record<string, unknown>[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  const PAGE_SIZE = 1000;
  const all: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const res = await fetch(`${url}/rest/v1/orders?select=*&order=id`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=none",
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[fetchAllOrders] fout:", res.status, await res.text());
      return all;
    }
    const page = (await res.json()) as Record<string, unknown>[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}
