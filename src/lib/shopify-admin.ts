/**
 * Shopify Admin API via Dev Dashboard client credentials (token verloopt na 24 uur).
 * @see https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens
 */

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2025-01";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class ShopifyAdminError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = "ShopifyAdminError";
  }
}

type ShopifyAdminConfig = {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
};

type TokenCache = {
  accessToken: string;
  scopes: string;
  expiresAt: number;
};

export type ShopifyAdminProductVariant = {
  id: number;
  title: string;
  sku: string | null;
  price: string;
  inventory_quantity?: number | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
};

export type ShopifyAdminProductOption = {
  id?: number;
  name: string;
  position?: number;
  values: string[];
};

export type ShopifyProductStatus = "active" | "draft" | "archived";

export type ShopifyAdminProduct = {
  id: number;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  product_type: string;
  tags: string;
  image?: { src?: string | null } | null;
  options?: ShopifyAdminProductOption[];
  variants: ShopifyAdminProductVariant[];
};

export function isShopifyProductActive(product: ShopifyAdminProduct): boolean {
  return String(product.status ?? "").toLowerCase() === "active";
}

let tokenCache: TokenCache | null = null;

function normalizeShopDomain(raw: string): string {
  const trimmed = raw.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!trimmed) return "";
  return trimmed.includes(".") ? trimmed : `${trimmed}.myshopify.com`;
}

function getShopifyAdminConfig(): ShopifyAdminConfig | null {
  const shopDomain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN ?? "");
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim() ?? "";
  if (!shopDomain || !clientId || !clientSecret) return null;
  return { shopDomain, clientId, clientSecret };
}

export function isShopifyAdminConfigured(): boolean {
  return getShopifyAdminConfig() !== null;
}

export function getShopifyAdminConfigStatus(): {
  configured: boolean;
  shopDomain: string | null;
  missing: string[];
} {
  const missing: string[] = [];
  if (!process.env.SHOPIFY_SHOP_DOMAIN?.trim()) missing.push("SHOPIFY_SHOP_DOMAIN");
  if (!process.env.SHOPIFY_CLIENT_ID?.trim()) missing.push("SHOPIFY_CLIENT_ID");
  if (!process.env.SHOPIFY_CLIENT_SECRET?.trim()) missing.push("SHOPIFY_CLIENT_SECRET");
  const config = getShopifyAdminConfig();
  return {
    configured: config !== null,
    shopDomain: config?.shopDomain ?? null,
    missing,
  };
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/i);
    if (!match) continue;
    try {
      return new URL(match[1]).searchParams.get("page_info");
    } catch {
      return null;
    }
  }
  return null;
}

async function requestAccessToken(config: ShopifyAdminConfig): Promise<TokenCache> {
  const url = `https://${config.shopDomain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || data;
    throw new ShopifyAdminError(
      "Shopify access token ophalen mislukt. Controleer Client ID/Secret en of de app op de winkel is geïnstalleerd.",
      res.status,
      detail
    );
  }

  const expiresInSec = Number.isFinite(data.expires_in) ? Number(data.expires_in) : 86399;
  return {
    accessToken: data.access_token,
    scopes: data.scope ?? "",
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}

export async function getShopifyAccessToken(): Promise<string> {
  const config = getShopifyAdminConfig();
  if (!config) {
    throw new ShopifyAdminError(
      "Shopify Admin API niet geconfigureerd. Zet SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID en SHOPIFY_CLIENT_SECRET."
    );
  }

  if (tokenCache && Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return tokenCache.accessToken;
  }

  tokenCache = await requestAccessToken(config);
  return tokenCache.accessToken;
}

export async function getShopifyAccessTokenInfo(): Promise<{
  scopes: string;
  expiresInSeconds: number;
}> {
  await getShopifyAccessToken();
  if (!tokenCache) {
    throw new ShopifyAdminError("Shopify token cache ontbreekt na ophalen.");
  }
  return {
    scopes: tokenCache.scopes,
    expiresInSeconds: Math.max(0, Math.floor((tokenCache.expiresAt - Date.now()) / 1000)),
  };
}

export async function shopifyAdminFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const config = getShopifyAdminConfig();
  if (!config) {
    throw new ShopifyAdminError(
      "Shopify Admin API niet geconfigureerd. Zet SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID en SHOPIFY_CLIENT_SECRET."
    );
  }

  const accessToken = await getShopifyAccessToken();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `https://${config.shopDomain}/admin/api/${SHOPIFY_API_VERSION}${normalizedPath}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ShopifyAdminError(
      `Shopify API-fout (${res.status}) voor ${normalizedPath}`,
      res.status,
      detail
    );
  }

  return res;
}

export async function shopifyAdminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await shopifyAdminFetch(path, init);
  return (await res.json()) as T;
}

export async function fetchShopifyProductsPage(options?: {
  limit?: number;
  pageInfo?: string | null;
  status?: ShopifyProductStatus;
}): Promise<{
  products: ShopifyAdminProduct[];
  nextPageInfo: string | null;
}> {
  const limit = Math.min(250, Math.max(1, options?.limit ?? 250));
  const params = new URLSearchParams({ limit: String(limit) });
  if (options?.pageInfo) {
    params.set("page_info", options.pageInfo);
  } else if (options?.status) {
    params.set("status", options.status);
  }

  const res = await shopifyAdminFetch(`/products.json?${params.toString()}`);
  const data = (await res.json()) as { products?: ShopifyAdminProduct[] };
  return {
    products: data.products ?? [],
    nextPageInfo: parseNextPageInfo(res.headers.get("link")),
  };
}

export async function fetchAllShopifyProducts(options?: {
  maxPages?: number;
  status?: ShopifyProductStatus;
}): Promise<ShopifyAdminProduct[]> {
  const maxPages = Math.max(1, options?.maxPages ?? 100);
  const all: ShopifyAdminProduct[] = [];
  let pageInfo: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { products, nextPageInfo } = await fetchShopifyProductsPage({
      pageInfo,
      status: options?.status,
    });
    all.push(...products);
    if (!nextPageInfo || products.length === 0) break;
    pageInfo = nextPageInfo;
  }

  return all;
}

export async function searchShopifyProducts(
  query: string,
  limit = 20,
  options?: { status?: ShopifyProductStatus }
): Promise<ShopifyAdminProduct[]> {
  const q = query.trim();
  if (!q) return [];

  const params = new URLSearchParams({
    limit: String(Math.min(50, Math.max(1, limit))),
    title: q,
  });
  if (options?.status) {
    params.set("status", options.status);
  }

  const res = await shopifyAdminFetch(`/products.json?${params.toString()}`);
  const data = (await res.json()) as { products?: ShopifyAdminProduct[] };
  const products = (data.products ?? []).filter(isShopifyProductActive);

  if (products.length > 0) return products;

  // Fallback: bredere zoekactie en lokaal filteren.
  const all = await fetchAllShopifyProducts({ maxPages: 5, status: options?.status ?? "active" });
  const needle = q.toLowerCase();
  return all
    .filter((p) => {
      const hay = `${p.title} ${p.product_type} ${p.tags} ${p.vendor}`.toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, limit);
}

export type ShopifyCustomCollection = {
  id: number;
  title: string;
  handle: string;
};

/** Shopify custom collection handles voor voorraadcategorieën. */
export const INVENTORY_FIETS_COLLECTION_HANDLE = "alle-fatbikes";
export const INVENTORY_ONDERDEEL_COLLECTION_HANDLE = "onderdelen";

export async function fetchCustomCollections(): Promise<ShopifyCustomCollection[]> {
  const data = await shopifyAdminJson<{ custom_collections?: ShopifyCustomCollection[] }>(
    "/custom_collections.json?limit=250"
  );
  return data.custom_collections ?? [];
}

export async function fetchProductIdsInCollection(collectionId: number): Promise<number[]> {
  const ids: number[] = [];
  let pageInfo: string | null = null;

  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      limit: "250",
      collection_id: String(collectionId),
      fields: "id",
    });
    if (pageInfo) {
      params.delete("collection_id");
      params.set("page_info", pageInfo);
    }

    const res = await shopifyAdminFetch(`/products.json?${params.toString()}`);
    const data = (await res.json()) as { products?: { id: number }[] };
    for (const product of data.products ?? []) {
      ids.push(product.id);
    }

    const nextPageInfo = parseNextPageInfo(res.headers.get("link"));
    if (!nextPageInfo || (data.products ?? []).length === 0) break;
    pageInfo = nextPageInfo;
  }

  return ids;
}

export async function fetchInventoryCollectionProductIds(): Promise<{
  fietsProductIds: Set<number>;
  onderdeelProductIds: Set<number>;
}> {
  const collections = await fetchCustomCollections();
  const fatbikes = collections.find((c) => c.handle === INVENTORY_FIETS_COLLECTION_HANDLE);
  const onderdelen = collections.find((c) => c.handle === INVENTORY_ONDERDEEL_COLLECTION_HANDLE);

  const [fietsIds, onderdeelIds] = await Promise.all([
    fatbikes ? fetchProductIdsInCollection(fatbikes.id) : Promise.resolve([]),
    onderdelen ? fetchProductIdsInCollection(onderdelen.id) : Promise.resolve([]),
  ]);

  return {
    fietsProductIds: new Set(fietsIds),
    onderdeelProductIds: new Set(onderdeelIds),
  };
}
