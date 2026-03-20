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
 * Haalt ALLE orders op via directe REST-aanroep.
 * De Supabase JS-client triggert een onzichtbare db-max-rows limiet bij grote queries.
 * Directe fetch met service-role key omzeilt dit volledig.
 */
export async function fetchAllOrders(): Promise<Record<string, unknown>[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  const res = await fetch(`${url}/rest/v1/orders?select=*`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=none",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("[fetchAllOrders] fout:", res.status, await res.text());
    return [];
  }
  return res.json();
}
