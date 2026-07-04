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
import type { ShopifyLineItem, ShopifyOrder } from "@/lib/shopify-order";
import { allAccountEmails, shopifyWebhookOrderAppliesToOwner } from "@/lib/account";
import { buildInventoryStockKeyInfo, type InventoryStockKeyInfo } from "@/lib/inventory-stock-key";
import {
  isExcludedFromInventory,
  resolveBundleDeduction,
} from "@/lib/inventory-rules";

export type InventoryCategory = "fiets" | "onderdeel" | "overig";
export type InventorySource = "shopify" | "marktplaats" | "winkel" | "handmatig";
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
  created_at: string;
};

export type LineItemForDeduction = {
  name?: string | null;
  quantity?: number | null;
  product_id?: string | number | null;
  variant_id?: string | number | null;
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
  const withImage = group.entries.find((e) => e.product.image?.src);
  return withImage ?? group.entries[0];
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
  let inserted = 0;
  let updated = 0;
  let removed = 0;
  let variantCount = 0;

  const { data: existingRowsRaw } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail);

  let existingRows = (existingRowsRaw ?? []) as InventoryProductRow[];

  for (const group of Array.from(groups.values())) {
    variantCount += group.entries.length;

    const { product, variant } = pickRepresentativeEntry(group);
    const { stockInfo } = group;
    const variantIds = variantIdsForGroup(group);
    const variantIdSet = new Set(variantIds);
    const category = classifyInventoryCategory(product, categoryMap);
    const imageUrl = productImageUrl(product);

    const matches = existingRows.filter((row) =>
      rowMatchesGroup(row, stockInfo.groupKey, variantIdSet)
    );

    const payload = {
      shopify_product_id: product.id,
      shopify_variant_id: variant.id,
      shopify_variant_ids: variantIds,
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
        existingRows = existingRows.filter((row) => !duplicateIds.has(row.id));
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
        existingRows = existingRows.map((row) =>
          row.id === primary.id ? ({ ...row, ...payload, stock_quantity: stockQuantity } as InventoryProductRow) : row
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
      existingRows.push(insertedRow as InventoryProductRow);
    }
  }

  const inactiveProductIds = allProducts
    .filter((product) => !isShopifyProductActive(product) || isExcludedFromInventory(product))
    .map((product) => product.id);

  if (inactiveProductIds.length > 0) {
    const { data: deletedRows, error: deleteErr } = await supabase
      .from("inventory_products")
      .delete()
      .eq("owner_email", ownerEmail)
      .in("shopify_product_id", inactiveProductIds)
      .select("id");

    if (!deleteErr) {
      removed += deletedRows?.length ?? 0;
    }
  }

  const { data: excludedByTitle, error: titleDeleteErr } = await supabase
    .from("inventory_products")
    .delete()
    .eq("owner_email", ownerEmail)
    .or(
      "title.ilike.%onderhoudspakket%,title.ilike.%2x anti-lekbanden + montage%,title.eq.Volledig rijklaar"
    )
    .select("id");

  if (!titleDeleteErr) {
    removed += excludedByTitle?.length ?? 0;
  }

  return { inserted, updated, removed, total: variantCount };
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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

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
    .gte("created_at", `${today}T00:00:00`)
    .lte("created_at", `${today}T23:59:59`);

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

  return (data as InventoryProductRow | null) ?? null;
}

async function findProductForLineItem(
  supabase: SupabaseClient,
  ownerEmail: string,
  item: LineItemForDeduction
): Promise<InventoryProductRow | null> {
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

  const name = normalizeName(String(item.name ?? ""));
  if (!name) return null;

  const { data: byTitle } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .ilike("title", `%${String(item.name ?? "").trim()}%`)
    .limit(5);

  const exact = (byTitle ?? []).find((p) => normalizeName(p.title) === name);
  if (exact) return exact as InventoryProductRow;
  if (byTitle?.[0]) return byTitle[0] as InventoryProductRow;

  return null;
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
  });

  if (logErr) {
    return { ok: false, error: logErr.message };
  }

  return { ok: true, stockAfter: after };
}

async function markOrderDeducted(
  supabase: SupabaseClient,
  ownerEmail: string,
  source: "shopify" | "marktplaats",
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
    });
  }
}

export async function deductInventoryForShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;

  const lineItems: LineItemForDeduction[] = (order.line_items ?? []).map((li) => ({
    name: li.name,
    quantity: li.quantity,
    product_id: (li as ShopifyLineItem & { product_id?: number }).product_id,
    variant_id: (li as ShopifyLineItem & { variant_id?: number }).variant_id,
  }));

  if (lineItems.length === 0) return;

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    await deductInventoryForLineItems(supabase, {
      ownerEmail,
      source: "shopify",
      externalOrderId: shopifyOrderId,
      orderReference: String(order.name ?? shopifyOrderId),
      lineItems,
    });
  }
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
      const parsed = JSON.parse(lineItemsJson) as {
        name?: string;
        quantity?: number;
        variant_id?: string | number;
        product_id?: string | number;
      }[];
      if (Array.isArray(parsed)) {
        lineItems = parsed.map((li) => ({
          name: li.name,
          quantity: li.quantity ?? 1,
          variant_id: li.variant_id,
          product_id: li.product_id,
        }));
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
