import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllShopifyProducts,
  fetchCustomCollections,
  fetchProductsInCollection,
  isShopifyProductActive,
  type ShopifyAdminProduct,
  INVENTORY_ONDERDEEL_COLLECTION_HANDLE,
  INVENTORY_ACCESSOIRE_COLLECTION_HANDLE,
} from "@/lib/shopify-admin";
import {
  PARTS_COMPOSITIONS,
  PARTS_UNIT_MAPS,
  findPartsComposition,
  findPartsUnitMap,
  isPartsExcludedTitle,
  isPartsNonStockShopifyTitle,
  normalizePartsTitle,
  partsDuplicateCanonicalTitle,
} from "@/lib/inventory-parts-rules";
import type { InventoryCategory, InventoryProductRow } from "@/lib/inventory";

function productImageUrl(product: ShopifyAdminProduct): string | null {
  return product.image?.src ?? null;
}

function primaryVariantId(product: ShopifyAdminProduct): number {
  const v = product.variants?.[0];
  const id = Number(v?.id ?? 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function allVariantIds(product: ShopifyAdminProduct): number[] {
  return (product.variants ?? [])
    .map((v) => Number(v.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function groupKeyForPartsTitle(title: string): string {
  const slug = normalizePartsTitle(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `parts:${slug || "unknown"}`;
}

type StockBucket = {
  canonicalTitle: string;
  groupKey: string;
  category: InventoryCategory;
  shopifyProducts: ShopifyAdminProduct[];
};

export type RebuildPartsInventoryResult = {
  stockRowsUpserted: number;
  deductionsWritten: number;
  excluded: number;
  compositions: number;
  unitMaps: number;
  duplicatesMerged: number;
  warnings: string[];
};

/**
 * Bouw/ververs voorraadregels + aftrek-mappings voor collecties onderdelen & accessoires.
 * Fiets-regels blijven onaangeroerd.
 */
export async function rebuildPartsInventoryFromShopifyCollections(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<RebuildPartsInventoryResult> {
  const warnings: string[] = [];
  const collections = await fetchCustomCollections();
  const onderdelenCol = collections.find(
    (c) => c.handle === INVENTORY_ONDERDEEL_COLLECTION_HANDLE
  );
  const accessoiresCol = collections.find(
    (c) => c.handle === INVENTORY_ACCESSOIRE_COLLECTION_HANDLE
  );

  const [onderdelenRaw, accessoiresRaw] = await Promise.all([
    onderdelenCol ? fetchProductsInCollection(onderdelenCol.id) : Promise.resolve([]),
    accessoiresCol ? fetchProductsInCollection(accessoiresCol.id) : Promise.resolve([]),
  ]);

  const accessoireIds = new Set(
    accessoiresRaw.filter((p) => isShopifyProductActive(p)).map((p) => p.id)
  );
  const onderdeelIds = new Set(
    onderdelenRaw.filter((p) => isShopifyProductActive(p)).map((p) => p.id)
  );

  const byId = new Map<number, ShopifyAdminProduct>();
  for (const p of [...onderdelenRaw, ...accessoiresRaw]) {
    if (!isShopifyProductActive(p)) continue;
    byId.set(p.id, p);
  }

  // Bundels/excludes die niet in de collecties staan (bijv. 2x Anti-lek, Range Rover)
  // alsnog meenemen voor aftrek-mappings.
  const ruleTitleKeys = new Set<string>();
  for (const c of PARTS_COMPOSITIONS) {
    ruleTitleKeys.add(normalizePartsTitle(c.setTitle));
    for (const comp of c.components) {
      ruleTitleKeys.add(normalizePartsTitle(comp.componentTitle));
    }
  }
  for (const u of PARTS_UNIT_MAPS) {
    ruleTitleKeys.add(normalizePartsTitle(u.sourceTitle));
    ruleTitleKeys.add(normalizePartsTitle(u.targetTitle));
  }
  const allActive = await fetchAllShopifyProducts({ status: "active" });
  for (const p of allActive) {
    if (!isShopifyProductActive(p)) continue;
    if (byId.has(p.id)) continue;
    const n = normalizePartsTitle(p.title);
    if (
      isPartsExcludedTitle(p.title) ||
      ruleTitleKeys.has(n) ||
      partsDuplicateCanonicalTitle(p.title)
    ) {
      byId.set(p.id, p);
    }
  }

  const titleIndex = new Map<string, ShopifyAdminProduct[]>();
  for (const p of Array.from(byId.values())) {
    const key = normalizePartsTitle(p.title);
    const list = titleIndex.get(key) ?? [];
    list.push(p);
    titleIndex.set(key, list);
  }

  function findByTitle(title: string): ShopifyAdminProduct | null {
    const list = titleIndex.get(normalizePartsTitle(title)) ?? [];
    return list[0] ?? null;
  }

  function categoryForProduct(p: ShopifyAdminProduct): InventoryCategory {
    if (accessoireIds.has(p.id)) return "accessoire";
    if (onderdeelIds.has(p.id)) return "onderdeel";
    return "overig";
  }

  // --- Stock buckets (eigen voorraadrij) ---
  const buckets = new Map<string, StockBucket>();

  function ensureBucket(
    canonicalTitle: string,
    product: ShopifyAdminProduct,
    category: InventoryCategory
  ): StockBucket {
    const key = normalizePartsTitle(canonicalTitle);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        canonicalTitle,
        groupKey: groupKeyForPartsTitle(canonicalTitle),
        category,
        shopifyProducts: [],
      };
      buckets.set(key, bucket);
    }
    if (!bucket.shopifyProducts.some((x) => x.id === product.id)) {
      bucket.shopifyProducts.push(product);
    }
    // Accessoire wint als één van de producten accessoire is.
    if (category === "accessoire") bucket.category = "accessoire";
    return bucket;
  }

  let excluded = 0;
  let compositions = 0;
  let unitMaps = 0;
  let duplicatesMerged = 0;

  for (const product of Array.from(byId.values())) {
    const title = String(product.title ?? "").trim();
    if (isPartsExcludedTitle(title)) {
      excluded++;
      continue;
    }
    if (findPartsComposition(title) || findPartsUnitMap(title)) {
      // Geen eigen stock-bucket; mappings later.
      if (findPartsComposition(title)) compositions++;
      if (findPartsUnitMap(title)) unitMaps++;
      continue;
    }

    const dup = partsDuplicateCanonicalTitle(title);
    if (dup) {
      ensureBucket(dup, product, categoryForProduct(product));
      if (normalizePartsTitle(title) === normalizePartsTitle(dup)) {
        // first/canonical
      } else {
        duplicatesMerged++;
      }
      continue;
    }

    ensureBucket(title, product, categoryForProduct(product));
  }

  // Componenten van sets moeten een stock-bucket hebben (ook als ze om een of andere
  // reden niet in de collectie-lijst stonden — wel waarschuwen).
  for (const set of Array.from(byId.values())
    .map((p) => findPartsComposition(p.title))
    .filter(Boolean)) {
    for (const c of set!.components) {
      const comp = findByTitle(c.componentTitle);
      if (!comp) {
        warnings.push(`Component niet gevonden in collecties: ${c.componentTitle}`);
        continue;
      }
      ensureBucket(c.componentTitle, comp, categoryForProduct(comp));
    }
  }
  for (const um of Array.from(byId.values())
    .map((p) => findPartsUnitMap(p.title))
    .filter(Boolean)) {
    const target = findByTitle(um!.targetTitle);
    if (!target) {
      warnings.push(`Unit-target niet gevonden: ${um!.targetTitle}`);
      continue;
    }
    ensureBucket(um!.targetTitle, target, categoryForProduct(target));
  }

  // --- Upsert inventory_products ---
  // Alle categorieën: oude fiets/overig-rijen met dezelfde titel/group_key moeten gematcht worden.
  const { data: existingRowsRaw } = await supabase
    .from("inventory_products")
    .select("*")
    .eq("owner_email", ownerEmail);

  const existingRows = (existingRowsRaw ?? []) as InventoryProductRow[];
  const existingByGroup = new Map(
    existingRows.map((r) => [String(r.group_key), r] as const)
  );
  const existingByTitle = new Map(
    existingRows.map((r) => [normalizePartsTitle(r.title), r] as const)
  );

  let stockRowsUpserted = 0;
  const inventoryIdByCanonical = new Map<string, string>();

  function rememberExisting(row: InventoryProductRow) {
    existingByGroup.set(String(row.group_key), row);
    existingByTitle.set(normalizePartsTitle(row.title), row);
  }

  for (const bucket of Array.from(buckets.values())) {
    const representative =
      bucket.shopifyProducts.find((p: ShopifyAdminProduct) => accessoireIds.has(p.id)) ??
      bucket.shopifyProducts[0]!;
    const variantIds = Array.from(
      new Set(bucket.shopifyProducts.flatMap((p: ShopifyAdminProduct) => allVariantIds(p)))
    );
    const variantId = primaryVariantId(representative) || variantIds[0] || 0;
    if (!variantId) {
      warnings.push(`Geen variant voor: ${bucket.canonicalTitle}`);
      continue;
    }

    const payload = {
      shopify_product_id: representative.id,
      shopify_variant_id: variantId,
      shopify_variant_ids: variantIds,
      group_key: bucket.groupKey,
      title: bucket.canonicalTitle,
      variant_title: null as string | null,
      model_name: bucket.canonicalTitle,
      color_name: null as string | null,
      product_type: representative.product_type || null,
      vendor: representative.vendor || null,
      tags: representative.tags || null,
      category: bucket.category,
      image_url: productImageUrl(representative),
    };

    let existing =
      existingByGroup.get(bucket.groupKey) ??
      existingByTitle.get(normalizePartsTitle(bucket.canonicalTitle)) ??
      null;

    // Zelfde slug, andere titel (zeldzaam) — alsnog op group_key matchen via DB.
    if (!existing) {
      const { data: byGroup } = await supabase
        .from("inventory_products")
        .select("*")
        .eq("owner_email", ownerEmail)
        .eq("group_key", bucket.groupKey)
        .maybeSingle();
      if (byGroup) {
        existing = byGroup as InventoryProductRow;
        rememberExisting(existing);
      }
    }

    if (existing) {
      const { data, error } = await supabase
        .from("inventory_products")
        .update(payload)
        .eq("id", existing.id)
        .eq("owner_email", ownerEmail)
        .select("id, group_key, title, category")
        .maybeSingle();
      if (error) {
        warnings.push(`Update mislukt ${bucket.canonicalTitle}: ${error.message}`);
        continue;
      }
      const id = data?.id ?? existing.id;
      inventoryIdByCanonical.set(normalizePartsTitle(bucket.canonicalTitle), id);
      rememberExisting({ ...existing, ...payload, id } as InventoryProductRow);
      stockRowsUpserted++;
    } else {
      const { data, error } = await supabase
        .from("inventory_products")
        .insert({
          owner_email: ownerEmail,
          ...payload,
          stock_quantity: 0,
        })
        .select("id, group_key, title, category")
        .maybeSingle();

      if (error) {
        // Race / slug-collision: update bestaande rij op group_key.
        const { data: conflict } = await supabase
          .from("inventory_products")
          .select("*")
          .eq("owner_email", ownerEmail)
          .eq("group_key", bucket.groupKey)
          .maybeSingle();
        if (conflict) {
          const { data: updated, error: upErr } = await supabase
            .from("inventory_products")
            .update(payload)
            .eq("id", conflict.id)
            .eq("owner_email", ownerEmail)
            .select("id")
            .maybeSingle();
          if (upErr) {
            warnings.push(`Insert/update mislukt ${bucket.canonicalTitle}: ${upErr.message}`);
            continue;
          }
          const id = updated?.id ?? conflict.id;
          inventoryIdByCanonical.set(normalizePartsTitle(bucket.canonicalTitle), id);
          rememberExisting({ ...(conflict as InventoryProductRow), ...payload, id });
          stockRowsUpserted++;
        } else {
          warnings.push(`Insert mislukt ${bucket.canonicalTitle}: ${error.message}`);
          continue;
        }
      } else if (data) {
        inventoryIdByCanonical.set(normalizePartsTitle(bucket.canonicalTitle), data.id);
        rememberExisting({
          ...(data as InventoryProductRow),
          ...payload,
          id: data.id,
        } as InventoryProductRow);
        stockRowsUpserted++;
      }
    }
  }

  // --- Rewrite deductions for these shopify product ids ---
  const shopifyIds = Array.from(byId.keys());
  // Also Range Rover / exclude-only products not in collections
  // (they may still appear in orders elsewhere — skip if not in byId)

  if (shopifyIds.length > 0) {
    const chunk = 100;
    for (let i = 0; i < shopifyIds.length; i += chunk) {
      const slice = shopifyIds.slice(i, i + chunk);
      await supabase
        .from("inventory_shopify_deductions")
        .delete()
        .eq("owner_email", ownerEmail)
        .in("shopify_product_id", slice);
    }
  }

  const deductionRows: Array<{
    owner_email: string;
    shopify_product_id: number;
    shopify_variant_id: number | null;
    kind: "exclude" | "deduct";
    inventory_product_id: string | null;
    quantity: number;
    note: string | null;
  }> = [];

  function inventoryIdForTitle(title: string): string | null {
    return inventoryIdByCanonical.get(normalizePartsTitle(title)) ?? null;
  }

  async function resolveInventoryIdForTitle(title: string): Promise<string | null> {
    const cached = inventoryIdForTitle(title);
    if (cached) return cached;
    const existing = existingByTitle.get(normalizePartsTitle(title));
    if (existing?.id) {
      inventoryIdByCanonical.set(normalizePartsTitle(title), existing.id);
      return existing.id;
    }
    const { data } = await supabase
      .from("inventory_products")
      .select("id")
      .eq("owner_email", ownerEmail)
      .eq("group_key", groupKeyForPartsTitle(title))
      .maybeSingle();
    if (data?.id) {
      inventoryIdByCanonical.set(normalizePartsTitle(title), data.id);
      return data.id;
    }
    return null;
  }

  for (const product of Array.from(byId.values())) {
    const title = String(product.title ?? "").trim();
    const pid = product.id;

    if (isPartsExcludedTitle(title)) {
      deductionRows.push({
        owner_email: ownerEmail,
        shopify_product_id: pid,
        shopify_variant_id: null,
        kind: "exclude",
        inventory_product_id: null,
        quantity: 1,
        note: "excluded",
      });
      continue;
    }

    const composition = findPartsComposition(title);
    if (composition) {
      for (const c of composition.components) {
        const invId = await resolveInventoryIdForTitle(c.componentTitle);
        if (!invId) {
          warnings.push(
            `Samenstelling ${title}: geen voorraadrij voor ${c.componentTitle}`
          );
          continue;
        }
        deductionRows.push({
          owner_email: ownerEmail,
          shopify_product_id: pid,
          shopify_variant_id: null,
          kind: "deduct",
          inventory_product_id: invId,
          quantity: c.quantity,
          note: `composition:${composition.setTitle}`,
        });
      }
      continue;
    }

    const unitMap = findPartsUnitMap(title);
    if (unitMap) {
      const invId = await resolveInventoryIdForTitle(unitMap.targetTitle);
      if (!invId) {
        warnings.push(`Unit-map ${title}: geen voorraadrij voor ${unitMap.targetTitle}`);
        continue;
      }
      deductionRows.push({
        owner_email: ownerEmail,
        shopify_product_id: pid,
        shopify_variant_id: null,
        kind: "deduct",
        inventory_product_id: invId,
        quantity: unitMap.quantity,
        note: `unit_map:${unitMap.targetTitle}`,
      });
      continue;
    }

    const dup = partsDuplicateCanonicalTitle(title);
    const canonical = dup ?? title;
    const invId = await resolveInventoryIdForTitle(canonical);
    if (!invId) {
      warnings.push(`Geen voorraadrij voor ${title}`);
      continue;
    }
    deductionRows.push({
      owner_email: ownerEmail,
      shopify_product_id: pid,
      shopify_variant_id: null,
      kind: "deduct",
      inventory_product_id: invId,
      quantity: 1,
      note: dup ? `duplicate:${canonical}` : null,
    });
  }

  let deductionsWritten = 0;
  for (let i = 0; i < deductionRows.length; i += 100) {
    const slice = deductionRows.slice(i, i + 100);
    const { error, data } = await supabase
      .from("inventory_shopify_deductions")
      .insert(slice)
      .select("id");
    if (error) {
      warnings.push(`Deduction insert failed: ${error.message}`);
    } else {
      deductionsWritten += data?.length ?? slice.length;
    }
  }

  // Verwijder voorraadrijen van uitgesloten titels (onderdeel/accessoire)
  for (const title of [
    "Fietspompje",
    "Achterzitje Ouxi V8",
    "Voorrekje voor Fatbikes",
    "Volledig rijklaar",
  ]) {
    await supabase
      .from("inventory_products")
      .delete()
      .eq("owner_email", ownerEmail)
      .ilike("title", title);
  }
  await supabase
    .from("inventory_products")
    .delete()
    .eq("owner_email", ownerEmail)
    .ilike("title", "%onderhoudspakket%");
  await supabase
    .from("inventory_products")
    .delete()
    .eq("owner_email", ownerEmail)
    .ilike("title", "%graag verzekeren%");
  await supabase
    .from("inventory_products")
    .delete()
    .eq("owner_email", ownerEmail)
    .ilike("title", "%Range Rover Velar%");

  // Sets / unit-map sources mogen geen eigen stock-rij houden
  for (const product of Array.from(byId.values())) {
    if (!isPartsNonStockShopifyTitle(product.title)) continue;
    if (isPartsExcludedTitle(product.title)) continue;
    // Alleen verwijderen als group_key exact parts:slug van dit product is
    // én niet canonical van iets anders
    const gk = groupKeyForPartsTitle(product.title);
    const canonicalDup = partsDuplicateCanonicalTitle(product.title);
    if (canonicalDup && normalizePartsTitle(canonicalDup) === normalizePartsTitle(product.title)) {
      continue;
    }
    if (findPartsComposition(product.title) || findPartsUnitMap(product.title)) {
      await supabase
        .from("inventory_products")
        .delete()
        .eq("owner_email", ownerEmail)
        .eq("group_key", gk);
    }
  }

  return {
    stockRowsUpserted,
    deductionsWritten,
    excluded,
    compositions,
    unitMaps,
    duplicatesMerged,
    warnings,
  };
}
