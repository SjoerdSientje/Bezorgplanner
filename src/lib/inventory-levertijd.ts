import type { SupabaseClient } from "@supabase/supabase-js";
import { getAmsterdamCalendarDate } from "@/lib/planning-date";
import { shopifyAdminJson } from "@/lib/shopify-admin";

/** Shopify product metafields die de voorraad-kolom `levertijd` sturen. */
export const LEVERTIJD_META_NAMESPACE = "custom";
export const LEVERTIJD_META_KEY = "levertijd";
export const RESTOCK_DATUM_META_KEY = "restock_datum";

export type ShopifyLevertijdMetafields = {
  shopifyProductId: number;
  levertijd: string | null;
  restockDatum: string | null;
};

function parseIsoDateOnly(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Shopify date metafield: YYYY-MM-DD
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Nederlands weergaveformaat voor restock-datum, bijv. "21 augustus 2026". */
export function formatRestockDatumForInventory(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Bepaal voorraad-levertijd uit metafields:
 * - restock_datum in de toekomst (strikt na vandaag Amsterdam) → die datum
 * - anders → levertijd-metafield (of null)
 */
export function resolveInventoryLevertijdFromMetafields(
  levertijdMeta: string | null | undefined,
  restockDatumMeta: string | null | undefined,
  todayAmsterdam = getAmsterdamCalendarDate(0)
): string | null {
  const restockIso = parseIsoDateOnly(restockDatumMeta);
  if (restockIso && restockIso > todayAmsterdam) {
    return formatRestockDatumForInventory(restockIso);
  }
  const lever = String(levertijdMeta ?? "").trim();
  return lever || null;
}

type GraphqlMetafieldNode = {
  id: string;
  metafieldLevertijd?: { value?: string | null } | null;
  metafieldRestock?: { value?: string | null } | null;
};

function gidToProductId(gid: string): number | null {
  const m = String(gid).match(/Product\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Haal custom.levertijd + custom.restock_datum op voor actieve Shopify-producten (GraphQL, gepagineerd).
 */
export async function fetchActiveProductLevertijdMetafields(options?: {
  maxPages?: number;
}): Promise<Map<number, ShopifyLevertijdMetafields>> {
  const maxPages = Math.max(1, options?.maxPages ?? 100);
  const result = new Map<number, ShopifyLevertijdMetafields>();
  let cursor: string | null = null;

  const query = `
    query LevertijdMetafields($cursor: String) {
      products(first: 50, after: $cursor, query: "status:active") {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          metafieldLevertijd: metafield(namespace: "${LEVERTIJD_META_NAMESPACE}", key: "${LEVERTIJD_META_KEY}") {
            value
          }
          metafieldRestock: metafield(namespace: "${LEVERTIJD_META_NAMESPACE}", key: "${RESTOCK_DATUM_META_KEY}") {
            value
          }
        }
      }
    }
  `;

  type GraphqlPage = {
    data?: {
      products?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: GraphqlMetafieldNode[];
      };
    };
    errors?: unknown;
  };

  for (let page = 0; page < maxPages; page++) {
    const data: GraphqlPage = await shopifyAdminJson<GraphqlPage>("/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { cursor },
      }),
    });

    if (data.errors) {
      console.error("[inventory-levertijd] GraphQL errors:", data.errors);
      break;
    }

    const products = data.data?.products as
      | {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: GraphqlMetafieldNode[];
        }
      | undefined;
    for (const node of products?.nodes ?? []) {
      const shopifyProductId = gidToProductId(node.id);
      if (!shopifyProductId) continue;
      result.set(shopifyProductId, {
        shopifyProductId,
        levertijd: node.metafieldLevertijd?.value?.trim() || null,
        restockDatum: node.metafieldRestock?.value?.trim() || null,
      });
    }

    if (!products?.pageInfo?.hasNextPage || !products.pageInfo.endCursor) break;
    cursor = products.pageInfo.endCursor;
  }

  return result;
}

/** Metafields voor één Shopify-product (REST). */
export async function fetchLevertijdMetafieldsForProduct(
  shopifyProductId: number
): Promise<ShopifyLevertijdMetafields> {
  const data = await shopifyAdminJson<{
    metafields?: Array<{ namespace?: string; key?: string; value?: string }>;
  }>(`/products/${shopifyProductId}/metafields.json`);

  let levertijd: string | null = null;
  let restockDatum: string | null = null;
  for (const mf of data.metafields ?? []) {
    if (mf.namespace !== LEVERTIJD_META_NAMESPACE) continue;
    if (mf.key === LEVERTIJD_META_KEY) levertijd = String(mf.value ?? "").trim() || null;
    if (mf.key === RESTOCK_DATUM_META_KEY) restockDatum = String(mf.value ?? "").trim() || null;
  }

  return { shopifyProductId, levertijd, restockDatum };
}

/**
 * Werk `inventory_products.levertijd` bij vanuit Shopify-metafields voor alle rijen van owner.
 */
export async function syncInventoryLevertijdFromShopifyMetafields(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<{ checked: number; updated: number; skipped: number }> {
  const metafieldsByProduct = await fetchActiveProductLevertijdMetafields();
  const today = getAmsterdamCalendarDate(0);

  const { data: rows, error } = await supabase
    .from("inventory_products")
    .select("id, shopify_product_id, levertijd")
    .eq("owner_email", ownerEmail);

  if (error) {
    throw new Error(error.message);
  }

  let updated = 0;
  let skipped = 0;
  const list = rows ?? [];

  for (const row of list) {
    const productId = Number(row.shopify_product_id);
    const meta = metafieldsByProduct.get(productId);
    const next = meta
      ? resolveInventoryLevertijdFromMetafields(meta.levertijd, meta.restockDatum, today)
      : null;

    const current = row.levertijd == null ? null : String(row.levertijd);
    if (current === next) {
      skipped++;
      continue;
    }

    const { error: updErr } = await supabase
      .from("inventory_products")
      .update({ levertijd: next })
      .eq("id", row.id)
      .eq("owner_email", ownerEmail);

    if (updErr) {
      console.error("[inventory-levertijd] update failed", row.id, updErr.message);
      continue;
    }
    updated++;
  }

  return { checked: list.length, updated, skipped };
}

/** Na product-webhook: levertijd voor dit Shopify-product verversen. */
export async function syncInventoryLevertijdForShopifyProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  shopifyProductId: number
): Promise<void> {
  if (!Number.isFinite(shopifyProductId) || shopifyProductId <= 0) return;

  const meta = await fetchLevertijdMetafieldsForProduct(shopifyProductId);
  const next = resolveInventoryLevertijdFromMetafields(meta.levertijd, meta.restockDatum);

  await supabase
    .from("inventory_products")
    .update({ levertijd: next })
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId);
}
