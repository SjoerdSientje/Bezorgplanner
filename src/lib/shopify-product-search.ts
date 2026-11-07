import {
  fetchAllShopifyProducts,
  fetchFatbikeCollectionProductIds,
  searchShopifyProducts,
  type ShopifyAdminProduct,
  type ShopifyAdminProductVariant,
} from "@/lib/shopify-admin";
import {
  matchesSearchQuery,
  scoreSearchMatch,
  tokenizeSearchQuery,
} from "@/lib/search-match";

export type ShopifyProductSearchResult = {
  shopify_product_id: number;
  shopify_variant_id: number;
  title: string;
  price: string | null;
  image_url: string | null;
};

/** fiets = alleen collectie alle-fatbikes; extra = alle actieve producten buiten die collectie. */
export type ShopifyProductSearchKind = "fiets" | "extra";

/** Zelfde naam als Shopify line items (producttitel + variant indien niet Default Title). */
export function buildShopifyLineItemTitle(
  product: ShopifyAdminProduct,
  variant: ShopifyAdminProductVariant
): string {
  const base = product.title.trim();
  const variantTitle = String(variant.title ?? "").trim();
  if (!variantTitle || /^default title$/i.test(variantTitle)) return base;
  return `${base} - ${variantTitle}`;
}

function productImageUrl(product: ShopifyAdminProduct): string | null {
  return product.image?.src?.trim() || null;
}

export { tokenizeSearchQuery, matchesSearchQuery as matchesAllSearchTokens };

function productHaystack(product: ShopifyAdminProduct): string {
  return `${product.title} ${product.product_type} ${product.tags} ${product.vendor}`;
}

function uniqueSearchTerms(query: string, tokens: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const add = (t: string) => {
    const key = t.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    terms.push(t.trim());
  };
  add(query);
  for (const token of tokens) add(token);
  // Ook compacte vorm voor Shopify title= API ("gt2000" vs "GT-2000")
  const compact = query.replace(/[^a-zA-Z0-9]+/g, "");
  if (compact.length >= 2) add(compact);
  return terms.slice(0, 5);
}

async function collectProductsForTokens(
  query: string,
  tokens: string[]
): Promise<Map<number, ShopifyAdminProduct>> {
  const productMap = new Map<number, ShopifyAdminProduct>();

  for (const term of uniqueSearchTerms(query, tokens)) {
    const batch = await searchShopifyProducts(term, 50, { status: "active" });
    for (const p of batch) productMap.set(p.id, p);
    if (productMap.size >= 60) break;
  }

  if (productMap.size < 8) {
    const all = await fetchAllShopifyProducts({ maxPages: 5, status: "active" });
    for (const p of all) {
      if (matchesSearchQuery(productHaystack(p), query)) {
        productMap.set(p.id, p);
      }
    }
  }

  return productMap;
}

/**
 * Live Shopify-producten voor orderformulieren (MP e.d.).
 * Geen voorraadgroepering — elke actieve variant is een aparte suggestie.
 *
 * `kind`:
 * - fiets → alleen actieve producten in collectie "alle-fatbikes"
 * - extra → alle andere actieve producten (niet in die collectie)
 */
export async function searchShopifyProductsForOrderForm(
  query: string,
  limit = 25,
  kind?: ShopifyProductSearchKind
): Promise<ShopifyProductSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const tokens = tokenizeSearchQuery(q);
  if (tokens.length === 0) return [];

  const [products, fatbikeIds] = await Promise.all([
    collectProductsForTokens(q, tokens),
    kind ? fetchFatbikeCollectionProductIds() : Promise.resolve(null),
  ]);
  const results: ShopifyProductSearchResult[] = [];

  for (const product of Array.from(products.values())) {
    if (fatbikeIds) {
      const inFatbikes = fatbikeIds.has(product.id);
      if (kind === "fiets" && !inFatbikes) continue;
      if (kind === "extra" && inFatbikes) continue;
    }

    const imageUrl = productImageUrl(product);
    for (const variant of product.variants ?? []) {
      const title = buildShopifyLineItemTitle(product, variant);
      if (!matchesSearchQuery(title, q)) continue;
      results.push({
        shopify_product_id: product.id,
        shopify_variant_id: variant.id,
        title,
        price: variant.price ?? null,
        image_url: imageUrl,
      });
    }
  }

  results.sort((a, b) => {
    const sb = scoreSearchMatch(b.title, q);
    const sa = scoreSearchMatch(a.title, q);
    if (sb !== sa) return sb - sa;
    return a.title.localeCompare(b.title, "nl");
  });

  return results.slice(0, limit);
}
