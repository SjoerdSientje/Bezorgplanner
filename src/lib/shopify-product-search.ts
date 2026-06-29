import {
  fetchAllShopifyProducts,
  searchShopifyProducts,
  type ShopifyAdminProduct,
  type ShopifyAdminProductVariant,
} from "@/lib/shopify-admin";

export type ShopifyProductSearchResult = {
  shopify_product_id: number;
  shopify_variant_id: number;
  title: string;
  price: string | null;
  image_url: string | null;
};

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

/** Splits zoekterm in losse woorden (spaties, slashes, komma's, enz.). */
export function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s/|,+\-–—]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Alle tokens moeten ergens in de haystack voorkomen (volgorde maakt niet uit). */
export function matchesAllSearchTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const hay = haystack.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

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
  return terms.slice(0, 4);
}

function scoreLineItemTitle(title: string, tokens: string[]): number {
  const hay = title.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    const idx = hay.indexOf(t);
    if (idx < 0) return -1;
    score += 120 - Math.min(idx, 119);
  }
  if (hay.startsWith(tokens[0] ?? "")) score += 40;
  score -= title.length / 200;
  return score;
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
      if (matchesAllSearchTokens(productHaystack(p), tokens)) {
        productMap.set(p.id, p);
      }
    }
  }

  return productMap;
}

/**
 * Live Shopify-producten voor orderformulieren (MP e.d.).
 * Geen voorraadgroepering — elke actieve variant is een aparte suggestie.
 * Zoekt op losse woorden: "V8 basic" matcht "OUXI V8 … Mat-zwart Basic".
 */
export async function searchShopifyProductsForOrderForm(
  query: string,
  limit = 25
): Promise<ShopifyProductSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const tokens = tokenizeSearchQuery(q);
  if (tokens.length === 0) return [];

  const products = await collectProductsForTokens(q, tokens);
  const results: ShopifyProductSearchResult[] = [];

  for (const product of Array.from(products.values())) {
    const imageUrl = productImageUrl(product);
    for (const variant of product.variants ?? []) {
      const title = buildShopifyLineItemTitle(product, variant);
      if (!matchesAllSearchTokens(title, tokens)) continue;
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
    const sb = scoreLineItemTitle(b.title, tokens);
    const sa = scoreLineItemTitle(a.title, tokens);
    if (sb !== sa) return sb - sa;
    return a.title.localeCompare(b.title, "nl");
  });

  return results.slice(0, limit);
}
