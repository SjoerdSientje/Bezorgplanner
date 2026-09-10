import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  buildInventoryStockKeyInfo,
  cleanTitleForGrouping,
} from "@/lib/inventory-stock-key";
import { isExcludedFromInventory } from "@/lib/inventory-rules";
import {
  fetchInventoryCollectionProductIds,
  isShopifyProductActive,
  type ShopifyAdminProduct,
  INVENTORY_FIETS_COLLECTION_HANDLE,
  INVENTORY_ONDERDEEL_COLLECTION_HANDLE,
  INVENTORY_ACCESSOIRE_COLLECTION_HANDLE,
} from "@/lib/shopify-admin";

export type InventoryCategory = "fiets" | "onderdeel" | "accessoire" | "overig";

function classifyCategory(
  productId: number,
  categoryMap: Awaited<ReturnType<typeof fetchInventoryCollectionProductIds>>
): InventoryCategory {
  if (categoryMap.fietsProductIds.has(productId)) return "fiets";
  if (categoryMap.accessoireProductIds.has(productId)) return "accessoire";
  if (categoryMap.onderdeelProductIds.has(productId)) return "onderdeel";
  return "overig";
}

export type PendingAiSuggestion = {
  type: "new_rule" | "link_existing";
  suggestedTitle?: string | null;
  inventoryProductId?: string | null;
  inventoryProductTitle?: string | null;
  rationale?: string | null;
};

export type InventoryPendingProductRow = {
  id: string;
  owner_email: string;
  shopify_product_id: number;
  shopify_variant_ids: number[];
  title: string;
  status: string;
  category: InventoryCategory;
  collection_handles: string[];
  image_url: string | null;
  ai_suggestion: PendingAiSuggestion | null;
  created_at: string;
  updated_at: string;
};

function productImageUrl(product: ShopifyAdminProduct): string | null {
  return product.image?.src ?? null;
}

function variantIdsOf(product: ShopifyAdminProduct): number[] {
  return (product.variants ?? [])
    .map((v) => Number(v.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function partsGroupKey(title: string): string {
  const slug = cleanTitleForGrouping(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `parts:${slug || "unknown"}`;
}

export function resolveCollectionMeta(
  productId: number,
  categoryMap: Awaited<ReturnType<typeof fetchInventoryCollectionProductIds>>
): { category: InventoryCategory; collectionHandles: string[] } {
  const handles: string[] = [];
  if (categoryMap.fietsProductIds.has(productId)) {
    handles.push(INVENTORY_FIETS_COLLECTION_HANDLE);
  }
  if (categoryMap.onderdeelProductIds.has(productId)) {
    handles.push(INVENTORY_ONDERDEEL_COLLECTION_HANDLE);
  }
  if (categoryMap.accessoireProductIds.has(productId)) {
    handles.push(INVENTORY_ACCESSOIRE_COLLECTION_HANDLE);
  }
  const category = classifyCategory(productId, categoryMap);
  return { category, collectionHandles: handles };
}

/** Product al gekoppeld aan een voorraadregel (direct of via aftrek-mapping)? */
export async function isShopifyProductLinkedToInventory(
  supabase: SupabaseClient,
  ownerEmail: string,
  shopifyProductId: number,
  variantIds: number[] = []
): Promise<boolean> {
  const { data: byProduct } = await supabase
    .from("inventory_products")
    .select("id")
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId)
    .limit(1)
    .maybeSingle();
  if (byProduct) return true;

  const { data: byDeduction } = await supabase
    .from("inventory_shopify_deductions")
    .select("id")
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId)
    .limit(1)
    .maybeSingle();
  if (byDeduction) return true;

  if (variantIds.length > 0) {
    const { data: rows } = await supabase
      .from("inventory_products")
      .select("id, shopify_variant_id, shopify_variant_ids")
      .eq("owner_email", ownerEmail);
    const want = new Set(variantIds);
    for (const row of rows ?? []) {
      if (want.has(Number(row.shopify_variant_id))) return true;
      for (const id of row.shopify_variant_ids ?? []) {
        if (want.has(Number(id))) return true;
      }
    }
  }

  return false;
}

export async function clearInventoryPendingProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  shopifyProductId: number
): Promise<void> {
  await supabase
    .from("inventory_pending_products")
    .delete()
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId);
}

function fallbackSuggestion(
  title: string,
  category: InventoryCategory
): PendingAiSuggestion {
  const cleaned = cleanTitleForGrouping(title) || title;
  return {
    type: "new_rule",
    suggestedTitle:
      category === "fiets"
        ? cleaned
        : cleaned,
    rationale: "Fallback: nieuwe voorraadregel (AI niet beschikbaar).",
  };
}

export async function suggestInventoryPendingAction(
  supabase: SupabaseClient,
  ownerEmail: string,
  params: {
    title: string;
    category: InventoryCategory;
  }
): Promise<PendingAiSuggestion> {
  const { title, category } = params;
  const cleaned = cleanTitleForGrouping(title) || title;

  const { data: candidates } = await supabase
    .from("inventory_products")
    .select("id, title, category, model_name, color_name")
    .eq("owner_email", ownerEmail)
    .eq("category", category)
    .order("title", { ascending: true })
    .limit(80);

  const rows = (candidates ?? []) as Array<{
    id: string;
    title: string;
    category: string;
    model_name: string | null;
    color_name: string | null;
  }>;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || rows.length === 0) {
    return fallbackSuggestion(title, category);
  }

  const catalog = rows.map((r) => ({
    id: r.id,
    title: r.title,
    model: r.model_name,
    color: r.color_name,
  }));

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Je helpt bij voorraadgroepering voor een fatbike-webshop.
Antwoord ALLEEN met JSON:
{"type":"new_rule","suggestedTitle":"...","rationale":"..."}
of
{"type":"link_existing","inventoryProductId":"<uuid>","rationale":"..."}

Regels:
- Zelfde fysieke fiets/onderdeel (alleen andere deal/basic/family/combi) → link_existing.
- Skinny ≠ fatbike, PRO ≠ PRO MAX ≠ Ultra, andere kleur ≠ zelfde regel.
- Sea Green ≠ Groen.
- Bij twijfel: new_rule.
- suggestedTitle: nette voorraadnaam zonder Combi-Deal/emoji.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            newProductTitle: title,
            cleanedTitle: cleaned,
            category,
            existingRules: catalog,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as PendingAiSuggestion;
    if (parsed?.type === "link_existing") {
      const id = String(parsed.inventoryProductId ?? "").trim();
      const match = rows.find((r) => r.id === id);
      if (!match) return fallbackSuggestion(title, category);
      return {
        type: "link_existing",
        inventoryProductId: match.id,
        inventoryProductTitle: match.title,
        rationale: parsed.rationale ?? null,
      };
    }
    if (parsed?.type === "new_rule") {
      return {
        type: "new_rule",
        suggestedTitle: String(parsed.suggestedTitle ?? cleaned).trim() || cleaned,
        rationale: parsed.rationale ?? null,
      };
    }
  } catch (err) {
    console.warn(
      "[inventory-pending] AI suggestie mislukt:",
      err instanceof Error ? err.message : err
    );
  }

  return fallbackSuggestion(title, category);
}

export async function enqueueInventoryPendingProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  product: ShopifyAdminProduct
): Promise<{ enqueued: boolean; pendingId?: string }> {
  if (!isShopifyProductActive(product) || isExcludedFromInventory(product)) {
    await clearInventoryPendingProduct(supabase, ownerEmail, Number(product.id));
    return { enqueued: false };
  }

  const shopifyProductId = Number(product.id);
  const variants = variantIdsOf(product);
  if (
    await isShopifyProductLinkedToInventory(
      supabase,
      ownerEmail,
      shopifyProductId,
      variants
    )
  ) {
    await clearInventoryPendingProduct(supabase, ownerEmail, shopifyProductId);
    return { enqueued: false };
  }

  const categoryMap = await fetchInventoryCollectionProductIds();
  const { category, collectionHandles } = resolveCollectionMeta(
    shopifyProductId,
    categoryMap
  );

  const { data: existingPending } = await supabase
    .from("inventory_pending_products")
    .select("id, ai_suggestion")
    .eq("owner_email", ownerEmail)
    .eq("shopify_product_id", shopifyProductId)
    .maybeSingle();

  // Bestaande wachtrijregel: metadata bijwerken, AI niet opnieuw aanroepen.
  if (existingPending?.id) {
    const { error: updErr } = await supabase
      .from("inventory_pending_products")
      .update({
        shopify_variant_ids: variants,
        title: String(product.title ?? "").trim() || `Product ${shopifyProductId}`,
        status: String(product.status ?? "active"),
        category,
        collection_handles: collectionHandles,
        image_url: productImageUrl(product),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingPending.id);
    if (updErr) {
      console.error("[inventory-pending] enqueue update:", updErr.message);
      throw new Error(updErr.message);
    }
    return { enqueued: false, pendingId: existingPending.id };
  }

  const suggestion = await suggestInventoryPendingAction(supabase, ownerEmail, {
    title: product.title,
    category,
  });

  const payload = {
    owner_email: ownerEmail,
    shopify_product_id: shopifyProductId,
    shopify_variant_ids: variants,
    title: String(product.title ?? "").trim() || `Product ${shopifyProductId}`,
    status: String(product.status ?? "active"),
    category,
    collection_handles: collectionHandles,
    image_url: productImageUrl(product),
    ai_suggestion: suggestion,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("inventory_pending_products")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[inventory-pending] enqueue:", error.message);
    throw new Error(error.message);
  }

  return { enqueued: true, pendingId: data?.id };
}

export async function listInventoryPendingProducts(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<InventoryPendingProductRow[]> {
  const { data, error } = await supabase
    .from("inventory_pending_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InventoryPendingProductRow[];
}

export async function countInventoryPendingProducts(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<number> {
  const { count, error } = await supabase
    .from("inventory_pending_products")
    .select("id", { count: "exact", head: true })
    .eq("owner_email", ownerEmail);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

type ApplyMode = "new_rule" | "link_existing";

export async function applyPendingInventoryProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  pendingId: string,
  options: {
    mode: ApplyMode;
    title?: string | null;
    inventoryProductId?: string | null;
    stockQuantity?: number | null;
    product?: ShopifyAdminProduct | null;
  }
): Promise<{ inventoryProductId: string }> {
  const { data: pending, error } = await supabase
    .from("inventory_pending_products")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("id", pendingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pending) throw new Error("Pending product niet gevonden.");

  const shopifyProductId = Number(pending.shopify_product_id);
  const variantIds = (pending.shopify_variant_ids ?? [])
    .map((id: number) => Number(id))
    .filter((id: number) => Number.isFinite(id) && id > 0);
  const primaryVariantId = variantIds[0] ?? 0;
  if (!primaryVariantId) {
    throw new Error("Shopify-product heeft geen variant-id.");
  }

  const category = pending.category as InventoryCategory;

  if (options.mode === "link_existing") {
    const targetId = String(options.inventoryProductId ?? "").trim();
    if (!targetId) throw new Error("inventoryProductId is verplicht bij koppelen.");

    const { data: target, error: tErr } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("id", targetId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!target) throw new Error("Doel-voorraadregel niet gevonden.");

    const merged = Array.from(
      new Set([
        Number(target.shopify_variant_id),
        ...(target.shopify_variant_ids ?? []).map(Number),
        ...variantIds,
      ].filter((id) => Number.isFinite(id) && id > 0))
    );

    const { error: uErr } = await supabase
      .from("inventory_products")
      .update({
        shopify_variant_ids: merged,
      })
      .eq("id", target.id)
      .eq("owner_email", ownerEmail);
    if (uErr) throw new Error(uErr.message);

    if (category === "onderdeel" || category === "accessoire") {
      await supabase
        .from("inventory_shopify_deductions")
        .delete()
        .eq("owner_email", ownerEmail)
        .eq("shopify_product_id", shopifyProductId);
      const { error: dErr } = await supabase.from("inventory_shopify_deductions").insert({
        owner_email: ownerEmail,
        shopify_product_id: shopifyProductId,
        shopify_variant_id: null,
        kind: "deduct",
        inventory_product_id: target.id,
        quantity: 1,
        note: "pending_link",
      });
      if (dErr) throw new Error(dErr.message);
    }

    await clearInventoryPendingProduct(supabase, ownerEmail, shopifyProductId);
    return { inventoryProductId: target.id };
  }

  // new_rule
  const stock = Math.max(0, Math.floor(Number(options.stockQuantity ?? NaN)));
  if (!Number.isFinite(stock)) {
    throw new Error("stockQuantity is verplicht bij een nieuwe voorraadregel.");
  }

  const ruleTitle =
    String(options.title ?? "").trim() ||
    String(pending.ai_suggestion?.suggestedTitle ?? "").trim() ||
    cleanTitleForGrouping(pending.title) ||
    pending.title;

  let groupKey: string;
  let modelName: string = ruleTitle;
  let colorName: string | null = null;
  let displayTitle = ruleTitle;

  if (category === "fiets" && options.product) {
    const variant = options.product.variants?.[0];
    if (variant) {
      const info = buildInventoryStockKeyInfo(options.product, variant);
      groupKey = info.groupKey;
      modelName = info.modelName;
      colorName = info.colorName;
      displayTitle = info.displayTitle;
    } else {
      groupKey = partsGroupKey(ruleTitle);
    }
  } else if (category === "fiets") {
    // Geen live productobject: gebruik AI/user titel als display, stabiele parts-achtige key vermijden
    const fakeVariant = {
      id: primaryVariantId,
      title: "Default",
      sku: null,
      price: "0",
    };
    const fakeProduct = {
      id: shopifyProductId,
      title: pending.title,
      handle: "",
      status: "active",
      vendor: "",
      product_type: "",
      tags: "",
      options: [],
      variants: [fakeVariant],
    } as ShopifyAdminProduct;
    const info = buildInventoryStockKeyInfo(fakeProduct, fakeVariant as any);
    groupKey = info.groupKey;
    modelName = info.modelName || ruleTitle;
    colorName = info.colorName;
    displayTitle = ruleTitle.includes("—") ? ruleTitle : info.displayTitle;
  } else {
    groupKey = partsGroupKey(ruleTitle);
    displayTitle = ruleTitle;
    modelName = ruleTitle;
  }

  const { data: inserted, error: iErr } = await supabase
    .from("inventory_products")
    .insert({
      owner_email: ownerEmail,
      shopify_product_id: shopifyProductId,
      shopify_variant_id: primaryVariantId,
      shopify_variant_ids: variantIds,
      group_key: groupKey,
      title: displayTitle,
      variant_title: null,
      model_name: modelName,
      color_name: colorName,
      category,
      image_url: pending.image_url,
      stock_quantity: stock,
    })
    .select("id")
    .single();

  if (iErr) {
    // Mogelijk group_key conflict → update bestaande
    if (/uq_inventory_products_owner_group_key|duplicate key/i.test(iErr.message)) {
      const { data: existing } = await supabase
        .from("inventory_products")
        .select("*")
        .eq("owner_email", ownerEmail)
        .eq("group_key", groupKey)
        .maybeSingle();
      if (existing) {
        const merged = Array.from(
          new Set([
            Number(existing.shopify_variant_id),
            ...(existing.shopify_variant_ids ?? []).map(Number),
            ...variantIds,
          ].filter((id) => id > 0))
        );
        await supabase
          .from("inventory_products")
          .update({
            shopify_variant_ids: merged,
            title: displayTitle,
            category,
            stock_quantity: Number(existing.stock_quantity ?? 0) + stock,
          })
          .eq("id", existing.id);
        if (category === "onderdeel" || category === "accessoire") {
          await supabase
            .from("inventory_shopify_deductions")
            .delete()
            .eq("owner_email", ownerEmail)
            .eq("shopify_product_id", shopifyProductId);
          await supabase.from("inventory_shopify_deductions").insert({
            owner_email: ownerEmail,
            shopify_product_id: shopifyProductId,
            shopify_variant_id: null,
            kind: "deduct",
            inventory_product_id: existing.id,
            quantity: 1,
            note: "pending_new_rule_merged",
          });
        }
        await clearInventoryPendingProduct(supabase, ownerEmail, shopifyProductId);
        return { inventoryProductId: existing.id };
      }
    }
    throw new Error(iErr.message);
  }

  if (category === "onderdeel" || category === "accessoire") {
    await supabase.from("inventory_shopify_deductions").insert({
      owner_email: ownerEmail,
      shopify_product_id: shopifyProductId,
      shopify_variant_id: null,
      kind: "deduct",
      inventory_product_id: inserted.id,
      quantity: 1,
      note: "pending_new_rule",
    });
  }

  await clearInventoryPendingProduct(supabase, ownerEmail, shopifyProductId);
  return { inventoryProductId: inserted.id };
}
