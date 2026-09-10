import type { SupabaseClient } from "@supabase/supabase-js";
import { getAmsterdamCalendarDate } from "@/lib/planning-date";
import { shopifyAdminFetch, shopifyAdminJson } from "@/lib/shopify-admin";

/** Shopify product metafields gekoppeld aan voorraad levertijd / restock. */
export const LEVERTIJD_META_NAMESPACE = "custom";
export const LEVERTIJD_META_KEY = "levertijd";
export const RESTOCK_DATUM_META_KEY = "restock_datum";

const LEVERTIJD_META_TYPE = "single_line_text_field";
const RESTOCK_DATUM_META_TYPE = "date";

export type ShopifyLevertijdMetafields = {
  shopifyProductId: number;
  levertijd: string | null;
  restockDatum: string | null;
};

export function parseIsoDateOnly(raw: string | null | undefined): string | null {
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
 * Weergave voor voorraadlijst:
 * - restock_datum in de toekomst (strikt na vandaag Amsterdam) → die datum (NL)
 * - anders → levertijd-tekst (of null)
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
 * (Legacy / optioneel — bron van waarheid is nu de app.)
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

async function findProductMetafieldId(
  shopifyProductId: number,
  key: string
): Promise<number | null> {
  const data = await shopifyAdminJson<{
    metafields?: Array<{ id?: number; namespace?: string; key?: string }>;
  }>(`/products/${shopifyProductId}/metafields.json`);

  for (const mf of data.metafields ?? []) {
    if (mf.namespace !== LEVERTIJD_META_NAMESPACE) continue;
    if (mf.key !== key) continue;
    const id = Number(mf.id);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

/**
 * Upsert of verwijder één product-metafield (lege value → delete).
 */
async function upsertOrDeleteProductMetafield(
  shopifyProductId: number,
  key: string,
  value: string | null,
  type: string
): Promise<"created" | "updated" | "deleted" | "skipped"> {
  const existingId = await findProductMetafieldId(shopifyProductId, key);
  const trimmed = value == null ? "" : String(value).trim();

  if (!trimmed) {
    if (!existingId) return "skipped";
    await shopifyAdminFetch(`/metafields/${existingId}.json`, { method: "DELETE" });
    return "deleted";
  }

  if (existingId) {
    await shopifyAdminJson(`/metafields/${existingId}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metafield: { id: existingId, value: trimmed, type },
      }),
    });
    return "updated";
  }

  await shopifyAdminJson(`/products/${shopifyProductId}/metafields.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metafield: {
        namespace: LEVERTIJD_META_NAMESPACE,
        key,
        value: trimmed,
        type,
      },
    }),
  });
  return "created";
}

/**
 * Schrijf levertijd + restock_datum van de app naar Shopify-metafields (hoofdproduct).
 */
export async function pushInventoryLevertijdMetafieldsToShopify(
  shopifyProductId: number,
  fields: { levertijd: string | null; restockDatum: string | null }
): Promise<{ levertijd: string; restockDatum: string }> {
  if (!Number.isFinite(shopifyProductId) || shopifyProductId <= 0) {
    throw new Error("Ongeldig Shopify-product-id.");
  }

  const restockIso = parseIsoDateOnly(fields.restockDatum);
  const levertijd = String(fields.levertijd ?? "").trim() || null;

  const levertijdAction = await upsertOrDeleteProductMetafield(
    shopifyProductId,
    LEVERTIJD_META_KEY,
    levertijd,
    LEVERTIJD_META_TYPE
  );
  const restockAction = await upsertOrDeleteProductMetafield(
    shopifyProductId,
    RESTOCK_DATUM_META_KEY,
    restockIso,
    RESTOCK_DATUM_META_TYPE
  );

  return { levertijd: levertijdAction, restockDatum: restockAction };
}

/**
 * Zelfde metafields naar meerdere Shopify-producten (alle koppelingen van één voorraadregel).
 */
export async function pushInventoryLevertijdMetafieldsToShopifyProducts(
  shopifyProductIds: number[],
  fields: { levertijd: string | null; restockDatum: string | null }
): Promise<{
  updated: number;
  failed: Array<{ shopifyProductId: number; error: string }>;
}> {
  const unique = Array.from(
    new Set(
      shopifyProductIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  const failed: Array<{ shopifyProductId: number; error: string }> = [];
  let updated = 0;

  for (const shopifyProductId of unique) {
    try {
      await pushInventoryLevertijdMetafieldsToShopify(shopifyProductId, fields);
      updated++;
    } catch (err) {
      failed.push({
        shopifyProductId,
        error: err instanceof Error ? err.message : "onbekende fout",
      });
    }
  }

  return { updated, failed };
}

/**
 * Legacy: werk lokale kolommen bij vanuit Shopify (niet meer aangeroepen bij sync).
 */
export async function syncInventoryLevertijdFromShopifyMetafields(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<{ checked: number; updated: number; skipped: number }> {
  const metafieldsByProduct = await fetchActiveProductLevertijdMetafields();

  const { data: rows, error } = await supabase
    .from("inventory_products")
    .select("id, shopify_product_id, levertijd, restock_datum")
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
    const nextLevertijd = meta?.levertijd ?? null;
    const nextRestock = parseIsoDateOnly(meta?.restockDatum ?? null);

    const currentLevertijd = row.levertijd == null ? null : String(row.levertijd);
    const currentRestock = parseIsoDateOnly(
      row.restock_datum == null ? null : String(row.restock_datum)
    );

    if (currentLevertijd === nextLevertijd && currentRestock === nextRestock) {
      skipped++;
      continue;
    }

    const { error: updErr } = await supabase
      .from("inventory_products")
      .update({ levertijd: nextLevertijd, restock_datum: nextRestock })
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

const DUTCH_MONTH_TO_NUM: Record<string, number> = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

/** Parse weergave zoals "21 augustus 2026" terug naar YYYY-MM-DD. */
export function parseDutchLongDateToIso(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  const m = s.match(/^(\d{1,2})\s+([a-zë]+)\s+(\d{4})$/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = DUTCH_MONTH_TO_NUM[m[2]];
  const year = Number(m[3]);
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (day < 1 || day > 31 || year < 2000) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Legacy webhook-pull (niet meer aangeroepen — bron van waarheid is de app).
 */
export async function syncInventoryLevertijdForShopifyProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  shopifyProductId: number
): Promise<{ updated: boolean; skipped: boolean; next: string | null }> {
  if (!Number.isFinite(shopifyProductId) || shopifyProductId <= 0) {
    return { updated: false, skipped: true, next: null };
  }

  const meta = await fetchLevertijdMetafieldsForProduct(shopifyProductId);
  const nextRestock = parseIsoDateOnly(meta.restockDatum);
  const nextLevertijd = meta.levertijd;
  const nextDisplay = resolveInventoryLevertijdFromMetafields(nextLevertijd, nextRestock);

  const { data: rows, error } = await supabase
    .from("inventory_products")
    .select("id, levertijd, restock_datum")
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId);

  if (error) {
    throw new Error(error.message);
  }

  const list = rows ?? [];
  if (list.length === 0) {
    return { updated: false, skipped: true, next: nextDisplay };
  }

  let updatedAny = false;
  for (const row of list) {
    const currentLevertijd = row.levertijd == null ? null : String(row.levertijd);
    const currentRestock = parseIsoDateOnly(
      row.restock_datum == null ? null : String(row.restock_datum)
    );
    if (currentLevertijd === nextLevertijd && currentRestock === nextRestock) continue;

    const { error: updErr } = await supabase
      .from("inventory_products")
      .update({ levertijd: nextLevertijd, restock_datum: nextRestock })
      .eq("id", row.id)
      .eq("owner_email", ownerEmail);

    if (updErr) {
      console.error("[inventory-levertijd] product update failed", row.id, updErr.message);
      continue;
    }
    updatedAny = true;
  }

  return { updated: updatedAny, skipped: !updatedAny, next: nextDisplay };
}

/**
 * Ochtendcheck: verlopen restock_datum lokaal wissen en metafields op alle
 * gekoppelde Shopify-producten wissen.
 */
export async function syncInventoryLevertijdPastRestockDates(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<{ checked: number; updated: number; skipped: number }> {
  const { getInventoryLinkedShopifyProducts } = await import("@/lib/inventory");
  const today = getAmsterdamCalendarDate(0);

  const { data: rows, error } = await supabase
    .from("inventory_products")
    .select("id, shopify_product_id, levertijd, restock_datum")
    .eq("owner_email", ownerEmail)
    .not("restock_datum", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  let checked = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const iso = parseIsoDateOnly(
      row.restock_datum == null ? null : String(row.restock_datum)
    );
    if (!iso || iso > today) {
      skipped++;
      continue;
    }

    checked++;
    const { error: updErr } = await supabase
      .from("inventory_products")
      .update({ restock_datum: null })
      .eq("id", row.id)
      .eq("owner_email", ownerEmail);

    if (updErr) {
      console.error("[inventory-levertijd] clear past restock failed", row.id, updErr.message);
      skipped++;
      continue;
    }

    try {
      const links = await getInventoryLinkedShopifyProducts(
        supabase,
        ownerEmail,
        String(row.id)
      );
      const ids = links.map((l) => l.shopifyProductId);
      const head = Number(row.shopify_product_id);
      if (ids.length === 0 && Number.isFinite(head) && head > 0) ids.push(head);

      await pushInventoryLevertijdMetafieldsToShopifyProducts(ids, {
        levertijd: row.levertijd == null ? null : String(row.levertijd),
        restockDatum: null,
      });
    } catch (err) {
      console.warn(
        "[inventory-levertijd] Shopify clear past restock failed",
        row.id,
        err instanceof Error ? err.message : err
      );
    }
    updated++;
  }

  return { checked, updated, skipped };
}
