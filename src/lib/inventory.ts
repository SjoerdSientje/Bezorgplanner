import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllShopifyProducts,
  fetchInventoryCollectionProductIds,
  isShopifyProductActive,
  searchShopifyProducts,
  shopifyAdminJson,
  type ShopifyAdminProduct,
  type ShopifyAdminProductVariant,
} from "@/lib/shopify-admin";
import type { ShopifyLineItem, ShopifyOrder, LineItemForJson } from "@/lib/shopify-order";
import { buildStructuredLineItems } from "@/lib/shopify-order";
import { allAccountEmails, getInventoryScanOwnerEmail, shopifyWebhookOrderAppliesToOwner } from "@/lib/account";
import { normalizeEmail } from "@/lib/auth-shared";
import { getAmsterdamCalendarDate, getAmsterdamDayUtcRange } from "@/lib/planning-date";
import {
  buildInventoryStockKeyInfo,
  isInventoryMarketingOverlayTitle,
  type InventoryStockKeyInfo,
} from "@/lib/inventory-stock-key";
import type { ProductDefaultItemsRulesV2 } from "@/lib/product-default-items-rules";
import { getResolvedDefaultItemsForFiets } from "@/lib/product-default-items-rules";
import { loadProductDefaultItemsRules } from "@/lib/product-rules-server";
import {
  isExcludedFromInventory,
  resolveBundleDeduction,
  shouldSkipInventoryDeductionLineItem,
} from "@/lib/inventory-rules";

export type InventoryCategory = "fiets" | "onderdeel" | "overig";
export type InventorySource = "shopify" | "marktplaats" | "winkel" | "handmatig" | "moneybird";
export type InventoryMutationType = "inkomend" | "uitgaand" | "correctie";

export const LOW_STOCK_THRESHOLD = 3;
export const INITIAL_STOCK = 10;

export type InventoryProductRow = {
  id: string;
  owner_email: string;
  shopify_product_id: number;
  shopify_variant_id: number;
  title: string;
  variant_title: string | null;
  product_type: string | null;
  vendor: string | null;
  tags: string | null;
  category: InventoryCategory;
  stock_quantity: number;
  image_url: string | null;
  group_key: string;
  model_name: string | null;
  color_name: string | null;
  shopify_variant_ids: number[];
  levertijd: string | null;
  opmerking: string | null;
  last_mutation_source: InventorySource | null;
  created_at: string;
  updated_at: string;
};

export type InventoryMutationRow = {
  id: string;
  product_id: string;
  mutation_type: InventoryMutationType;
  quantity: number;
  stock_before: number;
  stock_after: number;
  source: InventorySource;
  note: string | null;
  order_reference: string | null;
  order_producten: string | null;
  created_at: string;
};

export type LineItemForDeduction = {
  name?: string | null;
  quantity?: number | null;
  product_id?: string | number | null;
  variant_id?: string | number | null;
  /** Directe koppeling naar inventory_products.id (standaard-inbegrepen met voorraadregel). */
  inventory_product_id?: string | null;
};

type InventoryGroup = {
  stockInfo: InventoryStockKeyInfo;
  entries: Array<{ product: ShopifyAdminProduct; variant: ShopifyAdminProductVariant }>;
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type InventoryCategoryMap = {
  fietsProductIds: Set<number>;
  onderdeelProductIds: Set<number>;
};

export function classifyInventoryCategory(
  product: ShopifyAdminProduct,
  categoryMap: InventoryCategoryMap
): InventoryCategory {
  if (categoryMap.fietsProductIds.has(product.id)) return "fiets";
  if (categoryMap.onderdeelProductIds.has(product.id)) return "onderdeel";
  return "overig";
}

function productImageUrl(product: ShopifyAdminProduct): string | null {
  const img = product.image?.src;
  return img ?? null;
}

function buildInventoryGroups(products: ShopifyAdminProduct[]): Map<string, InventoryGroup> {
  const groups = new Map<string, InventoryGroup>();

  for (const product of products) {
    if (isExcludedFromInventory(product)) continue;

    for (const variant of product.variants ?? []) {
      const stockInfo = buildInventoryStockKeyInfo(product, variant);
      const existing = groups.get(stockInfo.groupKey);
      if (existing) {
        existing.entries.push({ product, variant });
      } else {
        groups.set(stockInfo.groupKey, { stockInfo, entries: [{ product, variant }] });
      }
    }
  }

  return groups;
}

function pickRepresentativeEntry(group: InventoryGroup): {
  product: ShopifyAdminProduct;
  variant: ShopifyAdminProductVariant;
} {
  // Fysieke fiets (niet combi/family/basic deal) heeft voorrang als voorraadrij-identiteit.
  const physical = group.entries.filter(
    (e) => !isInventoryMarketingOverlayTitle(e.product.title)
  );
  const pool = physical.length > 0 ? physical : group.entries;
  const withImage = pool.find((e) => e.product.image?.src);
  return withImage ?? pool[0];
}

function unionVariantIds(...lists: Array<Iterable<number>>): number[] {
  const set = new Set<number>();
  for (const list of lists) {
    for (const id of Array.from(list)) {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) set.add(n);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function variantIdsForGroup(group: InventoryGroup): number[] {
  return Array.from(new Set(group.entries.map((e) => e.variant.id))).sort((a, b) => a - b);
}

function rowMatchesGroup(
  row: InventoryProductRow,
  groupKey: string,
  variantIds: Set<number>
): boolean {
  if (row.group_key === groupKey) return true;
  if (variantIds.has(row.shopify_variant_id)) return true;
  return (row.shopify_variant_ids ?? []).some((id) => variantIds.has(id));
}

function pickPrimaryRow(
  matches: InventoryProductRow[],
  groupKey: string
): InventoryProductRow {
  return [...matches].sort((a, b) => {
    if (a.group_key === groupKey && b.group_key !== groupKey) return -1;
    if (b.group_key === groupKey && a.group_key !== groupKey) return 1;
    return a.created_at.localeCompare(b.created_at);
  })[0];
}

async function mergeDuplicateRows(
  supabase: SupabaseClient,
  primaryId: string,
  duplicates: InventoryProductRow[]
): Promise<void> {
  for (const dup of duplicates) {
    await supabase.from("inventory_mutations").update({ product_id: primaryId }).eq("product_id", dup.id);
    await supabase.from("inventory_products").delete().eq("id", dup.id);
  }
}

async function upsertInventoryGroups(
  supabase: SupabaseClient,
  ownerEmail: string,
  groups: Map<string, InventoryGroup>,
  categoryMap: InventoryCategoryMap,
  existingRows: InventoryProductRow[]
): Promise<{ inserted: number; updated: number; existingRows: InventoryProductRow[]; variantCount: number }> {
  let inserted = 0;
  let updated = 0;
  let variantCount = 0;
  let rows = existingRows;

  for (const group of Array.from(groups.values())) {
    variantCount += group.entries.length;

    const { product, variant } = pickRepresentativeEntry(group);
    const { stockInfo } = group;
    const incomingVariantIds = variantIdsForGroup(group);
    const variantIdSet = new Set(incomingVariantIds);
    const category = classifyInventoryCategory(product, categoryMap);
    const imageUrl = productImageUrl(product);
    const incomingIsOverlay = isInventoryMarketingOverlayTitle(product.title);

    const matches = rows.filter((row) =>
      rowMatchesGroup(row, stockInfo.groupKey, variantIdSet)
    );

    const mergedVariantIds = unionVariantIds(
      incomingVariantIds,
      ...matches.map((row) => [
        row.shopify_variant_id,
        ...(row.shopify_variant_ids ?? []),
      ])
    );

    // Marketing-deal op bestaande fysieke groep: alleen variant-ids koppelen.
    // Geen match (bijv. "LT5000 Combideal" terwijl LT5000 nog niet bestaat) → wél nieuwe
    // voorraadrij op de schoongemaakte group_key; latere base-fiets merge't daarop.
    if (matches.length > 0 && incomingIsOverlay) {
      const primary = pickPrimaryRow(matches, stockInfo.groupKey);
      const duplicates = matches.filter((row) => row.id !== primary.id);
      if (duplicates.length > 0) {
        await mergeDuplicateRows(supabase, primary.id, duplicates);
        const duplicateIds = new Set(duplicates.map((row) => row.id));
        rows = rows.filter((row) => !duplicateIds.has(row.id));
      }

      const { error } = await supabase
        .from("inventory_products")
        .update({
          shopify_variant_ids: mergedVariantIds,
          group_key: stockInfo.groupKey,
        })
        .eq("id", primary.id);

      if (!error) {
        updated++;
        rows = rows.map((row) =>
          row.id === primary.id
            ? ({
                ...row,
                shopify_variant_ids: mergedVariantIds,
                group_key: stockInfo.groupKey,
              } as InventoryProductRow)
            : row
        );
      }
      continue;
    }

    const payload = {
      shopify_product_id: product.id,
      shopify_variant_id: variant.id,
      shopify_variant_ids: mergedVariantIds,
      group_key: stockInfo.groupKey,
      title: stockInfo.displayTitle,
      variant_title: stockInfo.trimLabel,
      model_name: stockInfo.modelName,
      color_name: stockInfo.colorName,
      product_type: product.product_type || null,
      vendor: product.vendor || null,
      tags: product.tags || null,
      category,
      image_url: imageUrl,
    };

    if (matches.length > 0) {
      const primary = pickPrimaryRow(matches, stockInfo.groupKey);
      const duplicates = matches.filter((row) => row.id !== primary.id);
      if (duplicates.length > 0) {
        await mergeDuplicateRows(supabase, primary.id, duplicates);
        const duplicateIds = new Set(duplicates.map((row) => row.id));
        rows = rows.filter((row) => !duplicateIds.has(row.id));
      }

      const stockQuantity = Math.max(
        primary.stock_quantity,
        ...matches.map((row) => row.stock_quantity)
      );

      const { error } = await supabase
        .from("inventory_products")
        .update({ ...payload, stock_quantity: stockQuantity })
        .eq("id", primary.id);

      if (!error) {
        updated++;
        rows = rows.map((row) =>
          row.id === primary.id
            ? ({ ...row, ...payload, stock_quantity: stockQuantity } as InventoryProductRow)
            : row
        );
      }
      continue;
    }

    const { data: insertedRow, error } = await supabase
      .from("inventory_products")
      .insert({
        owner_email: ownerEmail,
        ...payload,
        stock_quantity: INITIAL_STOCK,
      })
      .select("*")
      .single();

    if (!error && insertedRow) {
      inserted++;
      rows.push(insertedRow as InventoryProductRow);
    }
  }

  return { inserted, updated, existingRows: rows, variantCount };
}

/**
 * Ontkoppel of verwijder een Shopify-product uit voorraad.
 * - Marketing-deal (combi/family/basic): nooit de fysieke voorraadrij wissen; alleen variant-ids loskoppelen.
 * - Fysiek product: rij verwijderen als dit de eigenaar is, anders alleen variant-ids strippen.
 */
export async function removeInventoryProductByShopifyId(
  supabase: SupabaseClient,
  ownerEmail: string,
  shopifyProductId: number,
  options?: {
    variantIds?: number[];
    title?: string | null;
  }
): Promise<number> {
  const variantIds = unionVariantIds(options?.variantIds ?? []);
  const titleHint = String(options?.title ?? "").trim();
  const incomingIsOverlay =
    titleHint.length > 0 ? isInventoryMarketingOverlayTitle(titleHint) : false;

  let touched = 0;

  // Altijd: strip bekende variant-ids uit alle rijen (deal loskoppelen onder V8).
  if (variantIds.length > 0) {
    const { data: candidatesRaw } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail);

    for (const row of (candidatesRaw ?? []) as InventoryProductRow[]) {
      const current = unionVariantIds([
        row.shopify_variant_id,
        ...(row.shopify_variant_ids ?? []),
      ]);
      const remaining = current.filter((id) => !variantIds.includes(id));
      if (remaining.length === current.length) continue;

      // Deal-ontkoppeling: voorraadrij blijft, aantallen blijven.
      if (remaining.length === 0 && row.shopify_product_id === shopifyProductId && !incomingIsOverlay) {
        const { error } = await supabase.from("inventory_products").delete().eq("id", row.id);
        if (!error) touched++;
        continue;
      }

      const nextPrimaryVariant = remaining[0] ?? row.shopify_variant_id;
      const { error } = await supabase
        .from("inventory_products")
        .update({
          shopify_variant_ids: remaining.length > 0 ? remaining : current,
          shopify_variant_id: nextPrimaryVariant,
        })
        .eq("id", row.id);
      if (!error) touched++;
    }
  }

  const { data: ownedRowsRaw } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId);

  const ownedRows = (ownedRowsRaw ?? []) as InventoryProductRow[];

  for (const row of ownedRows) {
    // Marketing-overlay (combi/family/basic): voorraad niet aanpassen.
    if (incomingIsOverlay) {
      continue;
    }

    // products/delete stuurt vaak alleen { id }. Geen titel → niet wissen als de
    // rij duidelijk een gedeelde groep is (meerdere variant-ids): voorkomt dat een
    // oude deal-eigenaar de V8-voorraad weggooit.
    if (titleHint.length === 0 && variantIds.length === 0) {
      const shared = (row.shopify_variant_ids?.length ?? 0) > 1;
      if (shared) continue;
    }

    const { error } = await supabase.from("inventory_products").delete().eq("id", row.id);
    if (!error) touched++;
  }

  return touched;
}

/**
 * Incrementele sync van één Shopify-product (create/update/status-change).
 * - Combi/family/basic deal → onderliggende groep (zelfde model+kleur), geen aparte voorraadrij.
 * - Nieuw model of kleur → nieuwe voorraadrij.
 * - Inactive/excluded → ontkoppelen (deal) of rij verwijderen (fysiek product).
 */
export async function syncInventoryProductFromShopify(
  supabase: SupabaseClient,
  ownerEmail: string,
  product: ShopifyAdminProduct
): Promise<{ inserted: number; updated: number; removed: number }> {
  const shopifyProductId = Number(product.id);
  if (!Number.isFinite(shopifyProductId) || shopifyProductId <= 0) {
    return { inserted: 0, updated: 0, removed: 0 };
  }

  const variantIds = (product.variants ?? [])
    .map((v) => Number(v.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!isShopifyProductActive(product) || isExcludedFromInventory(product)) {
    const removed = await removeInventoryProductByShopifyId(
      supabase,
      ownerEmail,
      shopifyProductId,
      { variantIds, title: product.title }
    );
    return { inserted: 0, updated: 0, removed };
  }

  const categoryMap = await fetchInventoryCollectionProductIds();
  const groups = buildInventoryGroups([product]);
  const keepGroupKeys = new Set(groups.keys());
  const groupKeys = Array.from(keepGroupKeys);

  // Belangrijk: match op group_key (V8 + kleur), niet alleen op dit Shopify-product-id —
  // anders krijgt een combideal een eigen voorraadrij i.p.v. onder V8 te hangen.
  let existingRows: InventoryProductRow[] = [];
  if (groupKeys.length > 0) {
    const { data: byGroup } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .in("group_key", groupKeys);
    existingRows = (byGroup ?? []) as InventoryProductRow[];
  }

  const { data: byProduct } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId);

  const seen = new Set(existingRows.map((r) => r.id));
  for (const row of (byProduct ?? []) as InventoryProductRow[]) {
    if (!seen.has(row.id)) {
      existingRows.push(row);
      seen.add(row.id);
    }
  }

  // Ook rijen die dit product's variant-ids al bevatten (oude sync-staat).
  if (variantIds.length > 0) {
    const { data: allRows } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail);
    for (const row of (allRows ?? []) as InventoryProductRow[]) {
      if (seen.has(row.id)) continue;
      const ids = new Set(
        unionVariantIds([row.shopify_variant_id, ...(row.shopify_variant_ids ?? [])])
      );
      if (variantIds.some((id) => ids.has(id))) {
        existingRows.push(row as InventoryProductRow);
        seen.add(row.id);
      }
    }
  }

  const { inserted, updated, existingRows: afterUpsert } = await upsertInventoryGroups(
    supabase,
    ownerEmail,
    groups,
    categoryMap,
    existingRows
  );

  // Alleen wees-rijen van DIT fysieke product opruimen — nooit een gedeelde groep wissen
  // omdat een deal-product een andere group_key had.
  const orphanIds = afterUpsert
    .filter(
      (row) =>
        row.shopify_product_id === shopifyProductId &&
        !keepGroupKeys.has(row.group_key) &&
        !isInventoryMarketingOverlayTitle(product.title)
    )
    .map((row) => row.id);

  let removed = 0;
  if (orphanIds.length > 0) {
    const { data: deletedRows, error } = await supabase
      .from("inventory_products")
      .delete()
      .in("id", orphanIds)
      .select("id");
    if (!error) removed = deletedRows?.length ?? 0;
  }

  return { inserted, updated, removed };
}

export async function syncInventoryFromShopify(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<{ inserted: number; updated: number; removed: number; total: number }> {
  const allProducts = await fetchAllShopifyProducts();
  const products = allProducts.filter(
    (product) => isShopifyProductActive(product) && !isExcludedFromInventory(product)
  );
  const categoryMap = await fetchInventoryCollectionProductIds();
  const groups = buildInventoryGroups(products);

  const { data: existingRowsRaw } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail);

  const existingRows = (existingRowsRaw ?? []) as InventoryProductRow[];

  const { inserted, updated, variantCount } = await upsertInventoryGroups(
    supabase,
    ownerEmail,
    groups,
    categoryMap,
    existingRows
  );

  // Alles wat niet meer in de actieve catalogus-groep zit (draft/archief/verwijderd) eruit.
  const keepGroupKeys = new Set(groups.keys());
  const removed = await pruneInventoryProductsOutsideGroupKeys(
    supabase,
    ownerEmail,
    keepGroupKeys
  );

  const { data: excludedByTitle, error: titleDeleteErr } = await supabase
    .from("inventory_products")
    .delete()
    .eq("owner_email", ownerEmail)
    .or(
      "title.ilike.%onderhoudspakket%,title.ilike.%2x anti-lekbanden + montage%,title.eq.Volledig rijklaar"
    )
    .select("id");

  let removedTotal = removed;
  if (!titleDeleteErr) {
    removedTotal += excludedByTitle?.length ?? 0;
  }

  return { inserted, updated, removed: removedTotal, total: variantCount };
}

/**
 * Verwijder voorraadrijen waarvan de group_key niet meer in de actieve Shopify-catalogus zit.
 * Zo verdwijnen draft/archief/verwijderde producten (visueel) uit voorraadbeheer.
 */
export async function pruneInventoryProductsOutsideGroupKeys(
  supabase: SupabaseClient,
  ownerEmail: string,
  keepGroupKeys: Set<string>
): Promise<number> {
  const { data: rows, error } = await supabase
    .from("inventory_products")
    .select("id, group_key")
    .eq("owner_email", ownerEmail);

  if (error) {
    console.error("[inventory] prune list error:", error.message);
    return 0;
  }

  const orphanIds = (rows ?? [])
    .filter((row) => !keepGroupKeys.has(String(row.group_key ?? "")))
    .map((row) => row.id as string);

  if (orphanIds.length === 0) return 0;

  let removed = 0;
  const chunkSize = 100;
  for (let i = 0; i < orphanIds.length; i += chunkSize) {
    const chunk = orphanIds.slice(i, i + chunkSize);
    const { data: deletedRows, error: deleteErr } = await supabase
      .from("inventory_products")
      .delete()
      .in("id", chunk)
      .select("id");
    if (!deleteErr) removed += deletedRows?.length ?? 0;
  }
  return removed;
}

/**
 * Actieve Shopify-catalogus → group_keys → prune inactieve/ontbrekende voorraadrijen.
 * Bruikbaar voor dagelijkse cron zonder volledige upsert.
 */
export async function pruneInactiveInventoryProducts(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<number> {
  const products = (await fetchAllShopifyProducts({ status: "active" })).filter(
    (product) => !isExcludedFromInventory(product)
  );
  const groups = buildInventoryGroups(products);
  return pruneInventoryProductsOutsideGroupKeys(
    supabase,
    ownerEmail,
    new Set(groups.keys())
  );
}

export async function getInventoryStats(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<{
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
  mutationsToday: number;
}> {
  const today = getAmsterdamCalendarDate(0);
  const { startUtcIso, endUtcIsoExclusive } = getAmsterdamDayUtcRange(today);

  const { data: products } = await supabase
    .from("inventory_products")
    .select("stock_quantity")
    .eq("owner_email", ownerEmail);

  const rows = products ?? [];
  const totalProducts = rows.length;
  const outOfStock = rows.filter((p) => p.stock_quantity === 0).length;
  const lowStock = rows.filter(
    (p) => p.stock_quantity > 0 && p.stock_quantity <= LOW_STOCK_THRESHOLD
  ).length;

  const { count } = await supabase
    .from("inventory_mutations")
    .select("id", { count: "exact", head: true })
    .eq("owner_email", ownerEmail)
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIsoExclusive);

  return {
    totalProducts,
    lowStock,
    outOfStock,
    mutationsToday: count ?? 0,
  };
}

async function findProductByTitleContains(
  supabase: SupabaseClient,
  ownerEmail: string,
  needle: string
): Promise<InventoryProductRow | null> {
  const { data } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .ilike("title", `%${needle}%`)
    .order("stock_quantity", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return (
    (await resolveCanonicalInventoryProduct(
      supabase,
      ownerEmail,
      data as InventoryProductRow
    )) ?? (data as InventoryProductRow)
  );
}

async function findProductForLineItem(
  supabase: SupabaseClient,
  ownerEmail: string,
  item: LineItemForDeduction
): Promise<InventoryProductRow | null> {
  const inventoryProductId = String(item.inventory_product_id ?? "").trim();
  if (inventoryProductId) {
    const { data } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("id", inventoryProductId)
      .maybeSingle();
    if (data) {
      return (
        (await resolveCanonicalInventoryProduct(
          supabase,
          ownerEmail,
          data as InventoryProductRow
        )) ?? (data as InventoryProductRow)
      );
    }
  }

  const variantId = item.variant_id != null ? Number(item.variant_id) : NaN;
  if (Number.isFinite(variantId) && variantId > 0) {
    const { data } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .contains("shopify_variant_ids", [variantId])
      .maybeSingle();
    if (data) return data as InventoryProductRow;

    const { data: legacy } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("shopify_variant_id", variantId)
      .maybeSingle();
    if (legacy) return legacy as InventoryProductRow;
  }

  const productId = item.product_id != null ? Number(item.product_id) : NaN;
  if (Number.isFinite(productId) && productId > 0) {
    const { data } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("shopify_product_id", productId)
      .order("stock_quantity", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as InventoryProductRow;
  }

  const lookupName =
    normalizeDeductionName(String(item.name ?? "")) === "telefoonhouder met opbergtasje" &&
    !normalizeName(String(item.name ?? "")).includes("telefoonhouder")
      ? "Telefoonhouder met Opbergtasje"
      : String(item.name ?? "");
  const name = normalizeName(lookupName);
  if (!name) return null;

  const { data: byTitle } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .ilike("title", `%${lookupName.trim()}%`)
    .limit(5);

  const exact = (byTitle ?? []).find((p) => normalizeName(p.title) === name);
  const found = (exact ?? byTitle?.[0] ?? null) as InventoryProductRow | null;
  if (!found) return null;
  return (await resolveCanonicalInventoryProduct(supabase, ownerEmail, found)) ?? found;
}

async function resolveCanonicalInventoryProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  row: InventoryProductRow
): Promise<InventoryProductRow | null> {
  const canonicalId = await resolveCanonicalInventoryProductId(supabase, ownerEmail, row.id);
  if (!canonicalId || canonicalId === row.id) return row;
  const { data } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("id", canonicalId)
    .maybeSingle();
  return (data as InventoryProductRow | null) ?? row;
}

/** Eén canoniek product per group_key (voorkomt mutaties op dubbele rijen). */
export async function resolveCanonicalInventoryProductId(
  supabase: SupabaseClient,
  ownerEmail: string,
  productId: string
): Promise<string | null> {
  const { data: row } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("id", productId)
    .maybeSingle();

  if (!row) return null;

  const groupKey = row.group_key as string;
  const { data: matches } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("group_key", groupKey);

  const rows = (matches ?? []) as InventoryProductRow[];
  if (rows.length <= 1) return productId;
  return pickPrimaryRow(rows, groupKey).id;
}

function normalizeDeductionName(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (/\btelefoontasje/.test(n) && !n.includes("telefoonhouder")) {
    return "telefoonhouder met opbergtasje";
  }
  return n;
}

function mergeDeductionLineItems(items: LineItemForDeduction[]): LineItemForDeduction[] {
  const map = new Map<string, LineItemForDeduction>();

  for (const item of items) {
    const name = String(item.name ?? "").trim();
    if (!name && !item.inventory_product_id) continue;
    const key = item.inventory_product_id
      ? `id:${item.inventory_product_id}`
      : normalizeDeductionName(name);
    const qty = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { ...item, name, quantity: qty });
      continue;
    }

    existing.quantity = Math.max(1, Math.floor(Number(existing.quantity ?? 1))) + qty;
    if (!existing.variant_id && item.variant_id) {
      existing.product_id = item.product_id;
      existing.variant_id = item.variant_id;
    }
    if (!existing.inventory_product_id && item.inventory_product_id) {
      existing.inventory_product_id = item.inventory_product_id;
    }
  }

  return Array.from(map.values());
}

function appendBikeDeductionItems(
  out: LineItemForDeduction[],
  row: {
    name: string;
    quantity: number;
    product_id?: string | number | null;
    variant_id?: string | number | null;
    defaultItems: string[];
  },
  explicitOrderNames?: Set<string>,
  resolvedDefaults?: { label: string; inventoryProductId: string | null }[]
): void {
  out.push({
    name: row.name,
    quantity: row.quantity,
    product_id: row.product_id ?? undefined,
    variant_id: row.variant_id ?? undefined,
  });

  const defaults =
    resolvedDefaults ??
    row.defaultItems.map((label) => ({ label, inventoryProductId: null as string | null }));

  for (const d of defaults) {
    const defaultName = d.label;
    if (!d.inventoryProductId && shouldSkipInventoryDeductionLineItem(defaultName)) continue;
    if (explicitOrderNames?.has(normalizeDeductionName(defaultName))) continue;
    out.push({
      name: defaultName,
      quantity: 1,
      inventory_product_id: d.inventoryProductId,
    });
  }
}

/** Bouw volledige aftreklijst: fiets + standaardproducten + family-deal + extra's. */
export function buildInventoryDeductionLineItems(
  lineItems: ShopifyLineItem[],
  rules: ProductDefaultItemsRulesV2
): LineItemForDeduction[] {
  if (!lineItems.length) return [];

  const structured = buildStructuredLineItems({ line_items: lineItems }, rules);
  const explicitOrderNames = new Set(
    structured
      .filter((row) => !row.isFiets && !shouldSkipInventoryDeductionLineItem(row.name))
      .map((row) => normalizeDeductionName(row.name))
  );
  const out: LineItemForDeduction[] = [];

  for (const row of structured) {
    if (shouldSkipInventoryDeductionLineItem(row.name)) continue;

    if (row.isFiets) {
      const resolved = getResolvedDefaultItemsForFiets(
        row.name,
        row.properties ?? [],
        rules
      );
      appendBikeDeductionItems(out, row, explicitOrderNames, resolved);
    } else {
      out.push({
        name: row.name,
        quantity: row.quantity,
        product_id: row.product_id ?? undefined,
        variant_id: row.variant_id ?? undefined,
      });
    }
  }

  return mergeDeductionLineItems(out);
}

function buildInventoryDeductionFromStructuredJson(
  structured: LineItemForJson[]
): LineItemForDeduction[] {
  const out: LineItemForDeduction[] = [];

  for (const row of structured) {
    if (shouldSkipInventoryDeductionLineItem(row.name)) continue;

    if (row.isFiets) {
      appendBikeDeductionItems(out, {
        name: row.name,
        quantity: 1,
        defaultItems: row.defaultItems,
      });
    } else {
      out.push({ name: row.name, quantity: 1 });
    }
  }

  return mergeDeductionLineItems(out);
}

export async function applyInventoryMutation(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    productId: string;
    mutationType: InventoryMutationType;
    quantity: number;
    source: InventorySource;
    note?: string | null;
    orderReference?: string | null;
    orderProducten?: string | null;
  }
): Promise<{ ok: true; stockAfter: number } | { ok: false; error: string }> {
  const qty = Math.max(0, Math.floor(params.quantity));
  if (qty <= 0 && params.mutationType !== "correctie") {
    return { ok: false, error: "Aantal moet groter dan 0 zijn." };
  }

  const { data: product, error: fetchErr } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", params.ownerEmail)
    .eq("id", params.productId)
    .maybeSingle();

  if (fetchErr || !product) {
    return { ok: false, error: "Product niet gevonden." };
  }

  const before = product.stock_quantity as number;
  let after = before;

  if (params.mutationType === "inkomend") {
    after = before + qty;
  } else if (params.mutationType === "uitgaand") {
    after = Math.max(0, before - qty);
  } else {
    after = Math.max(0, qty);
  }

  if (after === before && params.mutationType !== "correctie") {
    return { ok: true, stockAfter: before };
  }

  const { error: updateErr } = await supabase
    .from("inventory_products")
    .update({
      stock_quantity: after,
      last_mutation_source: params.source,
    })
    .eq("id", product.id);

  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  const loggedQty =
    params.mutationType === "correctie"
      ? Math.abs(after - before)
      : params.mutationType === "uitgaand"
        ? before - after
        : after - before;

  const { error: logErr } = await supabase.from("inventory_mutations").insert({
    owner_email: params.ownerEmail,
    product_id: product.id,
    mutation_type: params.mutationType,
    quantity: loggedQty,
    stock_before: before,
    stock_after: after,
    source: params.source,
    note: params.note?.trim() || null,
    order_reference: params.orderReference?.trim() || null,
    order_producten: params.orderProducten?.trim() || null,
  });

  if (logErr) {
    return { ok: false, error: logErr.message };
  }

  // Appje naar vast nummer wanneer voorraad precies 3 bereikt of naar 0 gaat.
  const hitThree = after === LOW_STOCK_THRESHOLD && before !== LOW_STOCK_THRESHOLD;
  const hitZero = after === 0 && before > 0;
  if (hitThree || hitZero) {
    const variant = String(product.variant_title ?? "").trim();
    const productTitle = variant
      ? `${String(product.title ?? "").trim()} (${variant})`
      : String(product.title ?? "").trim();
    try {
      const { notifyInventoryStockAlert } = await import("@/lib/whatsapp");
      const wa = await notifyInventoryStockAlert({
        productTitle: productTitle || "Product",
        stockAfter: after,
      });
      if (!wa.ok) {
        console.warn("[inventory] voorraad-alert WhatsApp mislukt:", wa.error);
      }
    } catch (e) {
      console.warn("[inventory] voorraad-alert WhatsApp fout:", e);
    }
  }

  return { ok: true, stockAfter: after };
}

export type InventoryMutationDetail = {
  id: string;
  productTitle: string;
  mutationType: InventoryMutationType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  source: InventorySource;
  note: string | null;
  createdAt: string;
};

export type InventoryMutationGroup = {
  orderReference: string | null;
  orderProducten: string | null;
  firstMutationAt: string;
  mutations: InventoryMutationDetail[];
};

/**
 * Mutaties van één Amsterdam-kalenderdag, gegroepeerd per order ("order",
 * "producten in order" uit de snapshot, en "werkelijke mutaties" die daarbij
 * zijn toegepast). Mutaties zonder order (handmatig/scan) krijgen elk hun
 * eigen groep met `orderReference: null`.
 */
export async function getInventoryMutationsForDay(
  supabase: SupabaseClient,
  ownerEmail: string,
  dateStr: string
): Promise<InventoryMutationGroup[]> {
  const { startUtcIso, endUtcIsoExclusive } = getAmsterdamDayUtcRange(dateStr);

  const { data: mutations } = await supabase
    .from("inventory_mutations")
    .select("*")
    .eq("owner_email", ownerEmail)
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIsoExclusive)
    .order("created_at", { ascending: true });

  const rows = (mutations ?? []) as InventoryMutationRow[];
  if (rows.length === 0) return [];

  const productIds = Array.from(new Set(rows.map((m) => m.product_id)));
  const { data: products } = await supabase
    .from("inventory_products")
    .select("id, title, variant_title")
    .in("id", productIds);

  const productTitleById = new Map<string, string>();
  for (const p of (products ?? []) as Array<{ id: string; title: string; variant_title: string | null }>) {
    const title =
      p.variant_title && p.variant_title !== "Default Title" ? `${p.title} — ${p.variant_title}` : p.title;
    productTitleById.set(p.id, title);
  }

  const groups = new Map<string, InventoryMutationGroup>();
  for (const m of rows) {
    const orderReference = m.order_reference?.trim() || null;
    const key = orderReference ?? `__geen_order_${m.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        orderReference,
        orderProducten: m.order_producten?.trim() || null,
        firstMutationAt: m.created_at,
        mutations: [],
      };
      groups.set(key, group);
    }
    if (!group.orderProducten && m.order_producten) {
      group.orderProducten = m.order_producten.trim() || null;
    }
    group.mutations.push({
      id: m.id,
      productTitle: productTitleById.get(m.product_id) ?? "Onbekend product",
      mutationType: m.mutation_type,
      quantity: m.quantity,
      stockBefore: m.stock_before,
      stockAfter: m.stock_after,
      source: m.source,
      note: m.note,
      createdAt: m.created_at,
    });
  }

  return Array.from(groups.values()).sort((a, b) => b.firstMutationAt.localeCompare(a.firstMutationAt));
}

async function markOrderDeducted(
  supabase: SupabaseClient,
  ownerEmail: string,
  source: "shopify" | "marktplaats" | "moneybird",
  externalOrderId: string
): Promise<boolean> {
  const { error } = await supabase.from("inventory_order_deductions").insert({
    owner_email: ownerEmail,
    source,
    external_order_id: externalOrderId,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("[inventory] deduction mark error:", error.message);
  return false;
}

async function hasOrderDeduction(
  supabase: SupabaseClient,
  ownerEmail: string,
  source: "shopify" | "marktplaats" | "moneybird",
  externalOrderId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("inventory_order_deductions")
    .select("external_order_id")
    .eq("owner_email", ownerEmail)
    .eq("source", source)
    .eq("external_order_id", externalOrderId)
    .maybeSingle();
  return Boolean(data);
}

async function clearOrderDeduction(
  supabase: SupabaseClient,
  ownerEmail: string,
  source: "shopify" | "marktplaats" | "moneybird",
  externalOrderId: string
): Promise<void> {
  const { error } = await supabase
    .from("inventory_order_deductions")
    .delete()
    .eq("owner_email", ownerEmail)
    .eq("source", source)
    .eq("external_order_id", externalOrderId);
  if (error) {
    console.error("[inventory] clear deduction mark error:", error.message);
  }
}

async function applyOutgoingMutationsForLineItems(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    source: InventorySource;
    orderReference: string;
    lineItems: LineItemForDeduction[];
  }
): Promise<void> {
  const orderProducten = formatLineItemsForSnapshot(params.lineItems);

  for (const item of params.lineItems) {
    const bundle = resolveBundleDeduction(item);
    if (bundle) {
      const product = await findProductByTitleContains(
        supabase,
        params.ownerEmail,
        bundle.targetTitleContains
      );
      if (product) {
        await applyInventoryMutation(supabase, {
          ownerEmail: params.ownerEmail,
          productId: product.id,
          mutationType: "uitgaand",
          quantity: bundle.quantity,
          source: params.source,
          note: `Bundel-aftrek (${item.name}) order ${params.orderReference}`,
          orderReference: params.orderReference,
          orderProducten,
        });
      }
      continue;
    }

    const qty = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
    const product = await findProductForLineItem(supabase, params.ownerEmail, item);
    if (!product) continue;

    await applyInventoryMutation(supabase, {
      ownerEmail: params.ownerEmail,
      productId: product.id,
      mutationType: "uitgaand",
      quantity: qty,
      source: params.source,
      note: `Automatische aftrek order ${params.orderReference}`,
      orderReference: params.orderReference,
      orderProducten,
    });
  }
}

async function applyIncomingMutationsForLineItems(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    source: InventorySource;
    orderReference: string;
    lineItems: LineItemForDeduction[];
  }
): Promise<void> {
  const orderProducten = formatLineItemsForSnapshot(params.lineItems);

  for (const item of params.lineItems) {
    const bundle = resolveBundleDeduction(item);
    if (bundle) {
      const product = await findProductByTitleContains(
        supabase,
        params.ownerEmail,
        bundle.targetTitleContains
      );
      if (product) {
        await applyInventoryMutation(supabase, {
          ownerEmail: params.ownerEmail,
          productId: product.id,
          mutationType: "inkomend",
          quantity: bundle.quantity,
          source: params.source,
          note: `Bundel-terugboeking annulering (${item.name}) order ${params.orderReference}`,
          orderReference: params.orderReference,
          orderProducten,
        });
      }
      continue;
    }

    const qty = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
    const product = await findProductForLineItem(supabase, params.ownerEmail, item);
    if (!product) continue;

    await applyInventoryMutation(supabase, {
      ownerEmail: params.ownerEmail,
      productId: product.id,
      mutationType: "inkomend",
      quantity: qty,
      source: params.source,
      note: `Terugboeking annulering order ${params.orderReference}`,
      orderReference: params.orderReference,
      orderProducten,
    });
  }
}

export async function deductInventoryForLineItems(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    source: "shopify" | "marktplaats";
    externalOrderId: string;
    orderReference: string;
    lineItems: LineItemForDeduction[];
  }
): Promise<void> {
  const isNew = await markOrderDeducted(
    supabase,
    params.ownerEmail,
    params.source,
    params.externalOrderId
  );
  if (!isNew) return;

  await applyOutgoingMutationsForLineItems(supabase, {
    ownerEmail: params.ownerEmail,
    source: params.source,
    orderReference: params.orderReference,
    lineItems: params.lineItems,
  });
}

function formatLineItemsForSnapshot(lineItems: LineItemForDeduction[]): string {
  return lineItems
    .map((item) => {
      const qty = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
      const name = (item.name ?? "").trim() || "Onbekend product";
      return `${qty}x ${name}`;
    })
    .join("\n");
}

export async function deductInventoryForShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;

  const rawItems = order.line_items ?? [];
  if (rawItems.length === 0) return;

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    const rules = await loadProductDefaultItemsRules(supabase, ownerEmail);
    const lineItems = buildInventoryDeductionLineItems(rawItems, rules);

    await deductInventoryForLineItems(supabase, {
      ownerEmail,
      source: "shopify",
      externalOrderId: shopifyOrderId,
      orderReference: String(order.name ?? shopifyOrderId),
      lineItems,
    });
  }
}

/**
 * Zet voorraad terug na Shopify-annulering.
 * Alleen als er eerder een shopify-aftrek-mark was; mark wordt daarna gewist (idempotent).
 */
export async function restoreInventoryForShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;

  const orderReference = String(order.name ?? shopifyOrderId);

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    const hadDeduction = await hasOrderDeduction(
      supabase,
      ownerEmail,
      "shopify",
      shopifyOrderId
    );
    if (!hadDeduction) continue;

    // Bij voorkeur netto mutaties terugdraaien (klopt ook na product-wijzigingen via update).
    const reversed = await reverseNetShopifyDeductionsForOrder(
      supabase,
      ownerEmail,
      orderReference,
      "Terugboeking annulering/verwijdering"
    );

    if (!reversed) {
      // Fallback: huidige line items (oude orders zonder nette mutatie-trail).
      const rawItems = order.line_items ?? [];
      if (rawItems.length > 0) {
        const rules = await loadProductDefaultItemsRules(supabase, ownerEmail);
        const lineItems = buildInventoryDeductionLineItems(rawItems, rules);
        await applyIncomingMutationsForLineItems(supabase, {
          ownerEmail,
          source: "shopify",
          orderReference,
          lineItems,
        });
      }
    }

    await clearOrderDeduction(supabase, ownerEmail, "shopify", shopifyOrderId);
    console.info(
      "[inventory] Shopify annulering/verwijdering — voorraad teruggeboekt",
      orderReference,
      "owner",
      ownerEmail
    );
  }
}

async function netShopifyDeductionsByProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderReference: string
): Promise<Map<string, number>> {
  const netByProduct = new Map<string, number>();
  const ref = String(orderReference ?? "").trim();
  if (!ref) return netByProduct;

  const { data: muts, error } = await supabase
    .from("inventory_mutations")
    .select("product_id, mutation_type, quantity")
    .eq("owner_email", ownerEmail)
    .eq("source", "shopify")
    .eq("order_reference", ref);

  if (error || !muts?.length) return netByProduct;

  for (const m of muts) {
    const productId = String(m.product_id ?? "").trim();
    if (!productId) continue;
    const qty = Math.max(0, Math.floor(Number(m.quantity ?? 0)));
    if (qty <= 0) continue;
    const type = String(m.mutation_type ?? "");
    const delta = type === "uitgaand" ? qty : type === "inkomend" ? -qty : 0;
    if (delta === 0) continue;
    netByProduct.set(productId, (netByProduct.get(productId) ?? 0) + delta);
  }
  return canonicalizeDeductionMap(supabase, ownerEmail, netByProduct);
}

async function canonicalizeDeductionMap(
  supabase: SupabaseClient,
  ownerEmail: string,
  input: Map<string, number>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const [productId, qty] of Array.from(input.entries())) {
    if (qty === 0) continue;
    const canonicalId =
      (await resolveCanonicalInventoryProductId(supabase, ownerEmail, productId)) ?? productId;
    out.set(canonicalId, (out.get(canonicalId) ?? 0) + qty);
  }
  return out;
}

async function desiredDeductionByProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  lineItems: LineItemForDeduction[]
): Promise<Map<string, number>> {
  const desired = new Map<string, number>();
  for (const item of lineItems) {
    const bundle = resolveBundleDeduction(item);
    if (bundle) {
      const product = await findProductByTitleContains(
        supabase,
        ownerEmail,
        bundle.targetTitleContains
      );
      if (product) {
        const canonical =
          (await resolveCanonicalInventoryProduct(supabase, ownerEmail, product)) ?? product;
        desired.set(canonical.id, (desired.get(canonical.id) ?? 0) + bundle.quantity);
      }
      continue;
    }
    const qty = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
    const product = await findProductForLineItem(supabase, ownerEmail, item);
    if (!product) continue;
    desired.set(product.id, (desired.get(product.id) ?? 0) + qty);
  }
  return desired;
}

/**
 * Alleen het verschil toepassen. Nooit alles terugboeken + opnieuw aftrekken:
 * extra's met voorraad 0 zitten wél in "gewenst" maar krijgen geen mutatie,
 * waardoor reverse+her-aftrek de fiets eindeloos 7→8→7 zette.
 */
async function applyShopifyInventoryDeltas(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    orderReference: string;
    lineItems: LineItemForDeduction[];
    currentNet: Map<string, number>;
    desired: Map<string, number>;
  }
): Promise<{ applied: number; skipped: boolean }> {
  const { ownerEmail, orderReference, lineItems, currentNet, desired } = params;
  const orderProducten = formatLineItemsForSnapshot(lineItems);
  const productIds = new Set([...Array.from(currentNet.keys()), ...Array.from(desired.keys())]);

  type Planned = { productId: string; mutationType: "uitgaand" | "inkomend"; quantity: number };
  const planned: Planned[] = [];

  for (const productId of Array.from(productIds)) {
    const want = desired.get(productId) ?? 0;
    const have = currentNet.get(productId) ?? 0;
    const delta = want - have;
    if (delta > 0) planned.push({ productId, mutationType: "uitgaand", quantity: delta });
    else if (delta < 0) planned.push({ productId, mutationType: "inkomend", quantity: -delta });
  }

  if (planned.length === 0) {
    return { applied: 0, skipped: true };
  }

  const actionable: Planned[] = [];
  for (const step of planned) {
    if (step.mutationType === "inkomend") {
      actionable.push(step);
      continue;
    }
    const { data: row } = await supabase
      .from("inventory_products")
      .select("stock_quantity")
      .eq("owner_email", ownerEmail)
      .eq("id", step.productId)
      .maybeSingle();
    if ((row?.stock_quantity ?? 0) <= 0) continue;
    actionable.push(step);
  }

  if (actionable.length === 0) {
    return { applied: 0, skipped: true };
  }

  for (const step of actionable) {
    await applyInventoryMutation(supabase, {
      ownerEmail,
      productId: step.productId,
      mutationType: step.mutationType,
      quantity: step.quantity,
      source: "shopify",
      note:
        step.mutationType === "uitgaand"
          ? `Automatische aftrek order ${orderReference}`
          : `Correctie na orderwijziging ${orderReference}`,
      orderReference,
      orderProducten,
    });
  }

  return { applied: actionable.length, skipped: false };
}

/**
 * Draai netto shopify-mutaties voor een order_reference terug (uitgaand − inkomend per product).
 * @returns true als er mutaties waren om terug te boeken.
 */
async function reverseNetShopifyDeductionsForOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderReference: string,
  notePrefix: string
): Promise<boolean> {
  const ref = String(orderReference ?? "").trim();
  if (!ref) return false;

  const netByProduct = await netShopifyDeductionsByProduct(
    supabase,
    ownerEmail,
    ref
  );
  if (netByProduct.size === 0) return false;

  let didAnything = false;
  for (const [productId, net] of Array.from(netByProduct.entries())) {
    if (net > 0) {
      await applyInventoryMutation(supabase, {
        ownerEmail,
        productId,
        mutationType: "inkomend",
        quantity: net,
        source: "shopify",
        note: `${notePrefix} order ${ref}`,
        orderReference: ref,
      });
      didAnything = true;
    } else if (net < 0) {
      await applyInventoryMutation(supabase, {
        ownerEmail,
        productId,
        mutationType: "uitgaand",
        quantity: -net,
        source: "shopify",
        note: `${notePrefix} correctie order ${ref}`,
        orderReference: ref,
      });
      didAnything = true;
    }
  }
  return didAnything;
}

/**
 * orders/updated: voorraad in sync brengen met huidige line items.
 * Alleen het verschil toepassen (geen terugboeking + her-aftrek).
 * Alleen als er al een shopify-aftrek was, of de order al in de planner staat.
 */
export async function syncInventoryForShopifyOrderUpdate(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;

  const orderReference = String(order.name ?? shopifyOrderId);
  const rawItems = order.line_items ?? [];

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    const hadDeduction = await hasOrderDeduction(
      supabase,
      ownerEmail,
      "shopify",
      shopifyOrderId
    );

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("owner_email", ownerEmail)
      .eq("order_id", shopifyOrderId)
      .eq("source", "shopify")
      .maybeSingle();

    if (!hadDeduction && !existingOrder?.id) {
      // Order stond niet in planner en had geen voorraadaftrek → niets doen (geen "stille create").
      continue;
    }

    if (rawItems.length === 0) {
      if (hadDeduction) {
        await reverseNetShopifyDeductionsForOrder(
          supabase,
          ownerEmail,
          orderReference,
          "Terugboeking vóór her-aftrek (order update)"
        );
        await clearOrderDeduction(supabase, ownerEmail, "shopify", shopifyOrderId);
      }
      console.info(
        "[inventory] Shopify update — geen line items, aftrek gewist",
        orderReference,
        ownerEmail
      );
      continue;
    }

    const rules = await loadProductDefaultItemsRules(supabase, ownerEmail);
    const lineItems = buildInventoryDeductionLineItems(rawItems, rules);

    if (hadDeduction) {
      const currentNet = await netShopifyDeductionsByProduct(
        supabase,
        ownerEmail,
        orderReference
      );
      const desired = await desiredDeductionByProduct(
        supabase,
        ownerEmail,
        lineItems
      );
      const result = await applyShopifyInventoryDeltas(supabase, {
        ownerEmail,
        orderReference,
        lineItems,
        currentNet,
        desired,
      });
      if (result.skipped) {
        console.info(
          "[inventory] Shopify update — voorraad al in sync, skip",
          orderReference,
          ownerEmail
        );
      } else {
        console.info(
          "[inventory] Shopify update — delta toegepast",
          orderReference,
          "stappen",
          result.applied,
          "owner",
          ownerEmail
        );
      }
      continue;
    }

    await deductInventoryForLineItems(supabase, {
      ownerEmail,
      source: "shopify",
      externalOrderId: shopifyOrderId,
      orderReference,
      lineItems,
    });

    console.info(
      "[inventory] Shopify update — eerste aftrek",
      orderReference,
      "owner",
      ownerEmail
    );
  }
}

function parseMoneybirdAmount(amount: string | null | undefined): number {
  const raw = String(amount ?? "1").trim();
  const m = raw.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return 1;
  const n = parseFloat(m[1]!.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.floor(n)) : 1;
}

type MoneybirdInvoiceDetailInput = {
  description?: string | null;
  amount?: string | null;
};

type MoneybirdInvoiceInput = {
  id?: string | null;
  invoice_id?: string | null;
  reference?: string | null;
  details?: MoneybirdInvoiceDetailInput[] | null;
};

function parseShopifyOrderIdFromInvoiceReference(
  reference: string | null | undefined
): string | null {
  const raw = String(reference ?? "").trim();
  const m = raw.match(/^shopify:(\d+)\b/i);
  return m?.[1] ?? null;
}

function moneybirdDetailsToLineItems(
  details: MoneybirdInvoiceDetailInput[] | null | undefined
): LineItemForDeduction[] {
  const out: LineItemForDeduction[] = [];
  for (const d of details ?? []) {
    const name = String(d.description ?? "").trim();
    if (!name) continue;
    // Strip " (#1234)" / " (orderName)" suffix we add when creating from Shopify.
    const cleanName = name.replace(/\s*\([^)]*\)\s*$/, "").trim() || name;
    out.push({
      name: cleanName,
      quantity: parseMoneybirdAmount(d.amount),
    });
  }
  return mergeDeductionLineItems(out);
}

function moneybirdInvoiceOwnerEmail(): string {
  const fromEnv = process.env.MONEYBIRD_INVOICE_OWNER_EMAIL?.trim();
  if (fromEnv) return normalizeEmail(fromEnv);
  return getInventoryScanOwnerEmail();
}

/**
 * Voorraadaftrek voor een Moneybird-factuur (aanroepen na verzenden, niet bij concept).
 * Idempotent op invoice-id. Skip stock als reference shopify:{id} al via Shopify is afgetrokken.
 */
export async function deductInventoryForMoneybirdInvoice(
  supabase: SupabaseClient,
  invoice: MoneybirdInvoiceInput
): Promise<{ deducted: boolean; skippedReason?: string }> {
  const invoiceId = String(invoice.id ?? "").trim();
  if (!invoiceId) return { deducted: false, skippedReason: "missing_invoice_id" };

  const ownerEmail = moneybirdInvoiceOwnerEmail();

  const shopifyOrderId = parseShopifyOrderIdFromInvoiceReference(invoice.reference);
  if (shopifyOrderId) {
    const alreadyViaShopify = await hasOrderDeduction(
      supabase,
      ownerEmail,
      "shopify",
      shopifyOrderId
    );
    if (alreadyViaShopify) {
      // Mark moneybird id zodat retries geen tweede poging doen.
      await markOrderDeducted(supabase, ownerEmail, "moneybird", invoiceId);
      console.info(
        "[inventory] Moneybird factuur",
        invoiceId,
        "skip — Shopify order",
        shopifyOrderId,
        "al afgetrokken"
      );
      return { deducted: false, skippedReason: "shopify_already_deducted" };
    }
  }

  const lineItems = moneybirdDetailsToLineItems(invoice.details);
  if (lineItems.length === 0) {
    return { deducted: false, skippedReason: "no_line_items" };
  }

  const isNew = await markOrderDeducted(supabase, ownerEmail, "moneybird", invoiceId);
  if (!isNew) {
    return { deducted: false, skippedReason: "already_processed" };
  }

  const orderReference =
    String(invoice.reference ?? "").trim() ||
    String(invoice.invoice_id ?? "").trim() ||
    `moneybird:${invoiceId}`;

  await applyOutgoingMutationsForLineItems(supabase, {
    ownerEmail,
    source: "moneybird",
    orderReference,
    lineItems,
  });

  return { deducted: true };
}

export async function deductInventoryForMpOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderId: string,
  orderNummer: string,
  lineItemsJson: string | null,
  productenText: string | null,
  deductionLineItems?: LineItemForDeduction[]
): Promise<void> {
  let lineItems: LineItemForDeduction[] = deductionLineItems ?? [];

  if (lineItems.length === 0 && lineItemsJson) {
    try {
      const parsed = JSON.parse(lineItemsJson) as LineItemForJson[];
      if (Array.isArray(parsed)) {
        lineItems = buildInventoryDeductionFromStructuredJson(parsed);
      }
    } catch {
      // fallback below
    }
  }

  if (lineItems.length === 0 && productenText) {
    lineItems = productenText
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name, quantity: 1 }));
  }

  if (lineItems.length === 0) return;

  await deductInventoryForLineItems(supabase, {
    ownerEmail,
    source: "marktplaats",
    externalOrderId: orderId,
    orderReference: orderNummer,
    lineItems,
  });
}

export type ShopifySearchResult = {
  shopify_product_id: number;
  shopify_variant_id: number;
  title: string;
  variant_title: string | null;
  image_url: string | null;
  price: string | null;
  stock_quantity: number | null;
  inventory_product_id: string | null;
};

export async function searchProductsForInventory(
  supabase: SupabaseClient,
  ownerEmail: string,
  query: string
): Promise<ShopifySearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const results: ShopifySearchResult[] = [];
  const seenGroupKeys = new Set<string>();

  // Eerst lokale voorraad (snel, betrouwbaar voor gesyncte producten).
  const { data: localRows } = await supabase
    .from("inventory_products")
    .select("id, title, stock_quantity, group_key, shopify_product_id, shopify_variant_id, image_url")
    .eq("owner_email", ownerEmail)
    .ilike("title", `%${q}%`)
    .order("title", { ascending: true })
    .limit(25);

  for (const row of localRows ?? []) {
    const groupKey = row.group_key as string;
    if (seenGroupKeys.has(groupKey)) continue;
    seenGroupKeys.add(groupKey);
    results.push({
      shopify_product_id: row.shopify_product_id as number,
      shopify_variant_id: row.shopify_variant_id as number,
      title: row.title as string,
      variant_title: null,
      image_url: (row.image_url as string | null) ?? null,
      price: null,
      stock_quantity: row.stock_quantity as number,
      inventory_product_id: row.id as string,
    });
  }

  if (results.length >= 25) {
    return enrichSearchResultsWithShopifyPrices(results);
  }

  const shopifyProducts = await searchShopifyProducts(q, 20, { status: "active" });
  const categoryMap = await fetchInventoryCollectionProductIds();

  for (const product of shopifyProducts) {
    if (isExcludedFromInventory(product)) continue;

    const imageUrl = productImageUrl(product);

    for (const variant of product.variants ?? []) {
      const stockInfo = buildInventoryStockKeyInfo(product, variant);
      if (seenGroupKeys.has(stockInfo.groupKey)) continue;
      seenGroupKeys.add(stockInfo.groupKey);

      const { data: localMatches } = await supabase
        .from("inventory_products")
        .select("id, stock_quantity, group_key, created_at")
        .eq("owner_email", ownerEmail)
        .eq("group_key", stockInfo.groupKey)
        .order("created_at", { ascending: true });

      const localRowsForGroup = (localMatches ?? []) as Pick<
        InventoryProductRow,
        "id" | "stock_quantity" | "group_key" | "created_at"
      >[];
      const localPrimary =
        localRowsForGroup.length > 0
          ? pickPrimaryRow(localRowsForGroup as InventoryProductRow[], stockInfo.groupKey)
          : null;

      let inventoryProductId = localPrimary?.id ?? null;
      let stockQuantity = localPrimary?.stock_quantity ?? null;

      if (!inventoryProductId) {
        const category = classifyInventoryCategory(product, categoryMap);
        const { data: inserted } = await supabase
          .from("inventory_products")
          .insert({
            owner_email: ownerEmail,
            shopify_product_id: product.id,
            shopify_variant_id: variant.id,
            shopify_variant_ids: [variant.id],
            group_key: stockInfo.groupKey,
            title: stockInfo.displayTitle,
            variant_title: stockInfo.trimLabel,
            model_name: stockInfo.modelName,
            color_name: stockInfo.colorName,
            product_type: product.product_type || null,
            vendor: product.vendor || null,
            tags: product.tags || null,
            category,
            stock_quantity: INITIAL_STOCK,
            image_url: imageUrl,
          })
          .select("id, stock_quantity")
          .single();

        if (inserted) {
          inventoryProductId = inserted.id;
          stockQuantity = inserted.stock_quantity;
        } else {
          const { data: existingAfterConflict } = await supabase
            .from("inventory_products")
            .select("id, stock_quantity, group_key, created_at")
            .eq("owner_email", ownerEmail)
            .eq("group_key", stockInfo.groupKey)
            .order("created_at", { ascending: true });

          const conflictRows = (existingAfterConflict ?? []) as InventoryProductRow[];
          if (conflictRows.length > 0) {
            const primary = pickPrimaryRow(conflictRows, stockInfo.groupKey);
            inventoryProductId = primary.id;
            stockQuantity = primary.stock_quantity;
          }
        }
      }

      results.push({
        shopify_product_id: product.id,
        shopify_variant_id: variant.id,
        title: stockInfo.displayTitle,
        variant_title: stockInfo.trimLabel,
        image_url: imageUrl,
        price: variant.price ?? null,
        stock_quantity: stockQuantity,
        inventory_product_id: inventoryProductId,
      });
    }
  }

  const enriched = await enrichSearchResultsWithShopifyPrices(results);
  return enriched.slice(0, 25);
}

/** Vul ontbrekende prijzen aan via Shopify variant-data (lokale voorraad heeft geen prijskolom). */
async function enrichSearchResultsWithShopifyPrices(
  results: ShopifySearchResult[]
): Promise<ShopifySearchResult[]> {
  const missing = results.filter((r) => (r.price == null || r.price === "") && r.shopify_variant_id);
  if (missing.length === 0) return results;

  const productIds = Array.from(new Set(missing.map((r) => r.shopify_product_id)));
  const priceByVariant = new Map<number, string>();

  await Promise.all(
    productIds.map(async (productId) => {
      try {
        const data = await shopifyAdminJson<{ product?: ShopifyAdminProduct }>(
          `/products/${productId}.json`
        );
        for (const v of data.product?.variants ?? []) {
          priceByVariant.set(v.id, v.price);
        }
      } catch (e) {
        console.warn("[inventory] variant price fetch", productId, e);
      }
    })
  );

  return results.map((r) =>
    r.price == null || r.price === ""
      ? { ...r, price: priceByVariant.get(r.shopify_variant_id) ?? null }
      : r
  );
}
