import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyWebhookOrderAppliesToOwner } from "@/lib/account";
import { shopifyAdminFetch } from "@/lib/shopify-admin";
import {
  extractPakketjesLineItems,
  pakketjesCustomerName,
  qualifiesForPakketjes,
  shopifyOrderCreatedAt,
  shopifyOrderDisplayAdres,
  type ShopifyOrder,
} from "@/lib/shopify-order";

export type PakketjesDbRow = {
  owner_email: string;
  shopify_order_id: string;
  order_nummer: string;
  naam: string;
  adres: string;
  items: { name: string; quantity: number }[];
  totaal_prijs: number;
  fulfillment_status: string | null;
  shopify_created_at: string;
};

export function buildPakketjesRow(order: ShopifyOrder, ownerEmail: string): PakketjesDbRow | null {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return null;
  const total = parseFloat(String(order.total_price ?? 0));
  const created = shopifyOrderCreatedAt(order);
  return {
    owner_email: ownerEmail,
    shopify_order_id: shopifyOrderId,
    order_nummer: String(order.name ?? ""),
    naam: pakketjesCustomerName(order),
    adres: shopifyOrderDisplayAdres(order),
    items: extractPakketjesLineItems(order),
    totaal_prijs: Number.isFinite(total) ? total : 0,
    fulfillment_status: order.fulfillment_status ?? null,
    shopify_created_at: created.toISOString(),
  };
}

function nextOrdersPagePath(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
  if (!m?.[1]) return null;
  try {
    const u = new URL(m[1]);
    const apiMatch = u.pathname.match(/\/admin\/api\/[^/]+(\/.*)$/);
    if (apiMatch?.[1]) return `${apiMatch[1]}${u.search}`;
  } catch {
    /* ignore */
  }
  return null;
}

/** Open Shopify-orders ophalen (paginated), optioneel vanaf created_at_min. */
export async function fetchOpenShopifyOrders(opts?: {
  createdAtMinIso?: string | null;
  maxPages?: number;
}): Promise<ShopifyOrder[]> {
  const maxPages = Math.max(1, opts?.maxPages ?? 20);
  const params = new URLSearchParams({
    status: "open",
    limit: "250",
    order: "created_at asc",
  });
  if (opts?.createdAtMinIso) {
    params.set("created_at_min", opts.createdAtMinIso);
  }

  const out: ShopifyOrder[] = [];
  let path: string | null = `/orders.json?${params.toString()}`;
  let pages = 0;

  while (path && pages < maxPages) {
    pages += 1;
    const res = await shopifyAdminFetch(path);
    const body = (await res.json()) as { orders?: ShopifyOrder[] };
    const batch = body.orders ?? [];
    out.push(...batch);
    path = nextOrdersPagePath(res.headers.get("link"));
    if (batch.length === 0) break;
  }

  return out;
}

/**
 * Synchroniseer open Shopify-orders naar pakketjes_orders voor één account.
 * Respecteert cutoff na "Pakketjes afgerond".
 */
export async function syncPakketjesForOwner(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<{ upserted: number; removed: number; scanned: number }> {
  const { data: cutoffRow } = await supabase
    .from("pakketjes_owner_cutoff")
    .select("ignore_shopify_created_before")
    .eq("owner_email", ownerEmail)
    .maybeSingle();

  const cutoffIso =
    typeof cutoffRow?.ignore_shopify_created_before === "string"
      ? cutoffRow.ignore_shopify_created_before
      : null;
  const cutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : 0;

  const orders = await fetchOpenShopifyOrders({
    createdAtMinIso: cutoffIso,
  });

  const qualifyingIds = new Set<string>();
  const rows: PakketjesDbRow[] = [];

  for (const order of orders) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;
    const orderCreatedMs = shopifyOrderCreatedAt(order).getTime();
    if (cutoffMs && orderCreatedMs < cutoffMs) continue;
    if (!qualifiesForPakketjes(order)) continue;
    const row = buildPakketjesRow(order, ownerEmail);
    if (!row) continue;
    qualifyingIds.add(row.shopify_order_id);
    rows.push(row);
  }

  let upserted = 0;
  if (rows.length > 0) {
    const { error } = await supabase.from("pakketjes_orders").upsert(rows, {
      onConflict: "owner_email,shopify_order_id",
    });
    if (error?.message?.includes("shopify_created_at")) {
      // Migratie 033 nog niet gedraaid: upsert zonder besteldatum-kolom.
      const withoutCreated = rows.map(({ shopify_created_at: _c, ...rest }) => rest);
      const { error: e2 } = await supabase.from("pakketjes_orders").upsert(withoutCreated, {
        onConflict: "owner_email,shopify_order_id",
      });
      if (e2) throw new Error(e2.message);
    } else if (error) {
      throw new Error(error.message);
    }
    upserted = rows.length;
  }

  // Verwijder lokale rijen die niet meer open/kwalificerend zijn (na cutoff).
  type ExistingRow = {
    id: string;
    shopify_order_id: string;
    shopify_created_at?: string | null;
    created_at?: string | null;
  };
  let existing: ExistingRow[] | null = null;
  {
    const q1 = await supabase
      .from("pakketjes_orders")
      .select("id, shopify_order_id, shopify_created_at, created_at")
      .eq("owner_email", ownerEmail);
    if (q1.error?.message?.includes("shopify_created_at")) {
      const q2 = await supabase
        .from("pakketjes_orders")
        .select("id, shopify_order_id, created_at")
        .eq("owner_email", ownerEmail);
      if (q2.error) throw new Error(q2.error.message);
      existing = q2.data as ExistingRow[];
    } else if (q1.error) {
      throw new Error(q1.error.message);
    } else {
      existing = q1.data as ExistingRow[];
    }
  }

  const toRemove: string[] = [];
  for (const r of existing ?? []) {
    const sid = String(r.shopify_order_id ?? "");
    if (qualifyingIds.has(sid)) continue;
    const createdMs = Date.parse(
      String(r.shopify_created_at ?? r.created_at ?? "")
    );
    // Alleen opruimen als we zeker weten dat sync dit bereik dekte (na cutoff).
    if (cutoffMs && Number.isFinite(createdMs) && createdMs < cutoffMs) continue;
    if (sid) toRemove.push(String(r.id));
  }

  let removed = 0;
  if (toRemove.length > 0) {
    const { error } = await supabase.from("pakketjes_orders").delete().in("id", toRemove);
    if (error) throw new Error(error.message);
    removed = toRemove.length;
  }

  return { upserted, removed, scanned: orders.length };
}
