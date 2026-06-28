import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import {
  fetchAllShopifyProducts,
  fetchShopifyProductsPage,
  getShopifyAdminConfigStatus,
  ShopifyAdminError,
} from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/shopify/products
 * Haalt producten op uit Shopify Admin API.
 *
 * Query params:
 * - all=true (default): alle pagina's ophalen
 * - page_info=...: één pagina via cursor
 * - limit=250: max per pagina (1-250)
 */
export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);

    const configStatus = getShopifyAdminConfigStatus();
    if (!configStatus.configured) {
      return NextResponse.json(
        {
          error: "Shopify Admin API niet geconfigureerd.",
          missing: configStatus.missing,
        },
        { status: 503 }
      );
    }

    const { searchParams } = request.nextUrl;
    const fetchAll = searchParams.get("all") !== "false";
    const pageInfo = searchParams.get("page_info");
    const limitRaw = parseInt(searchParams.get("limit") ?? "250", 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 250;

    if (fetchAll && !pageInfo) {
      const products = await fetchAllShopifyProducts();
      return NextResponse.json(
        {
          products,
          count: products.length,
          shopDomain: configStatus.shopDomain,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const page = await fetchShopifyProductsPage({
      limit,
      pageInfo,
    });

    return NextResponse.json(
      {
        products: page.products,
        count: page.products.length,
        nextPageInfo: page.nextPageInfo,
        shopDomain: configStatus.shopDomain,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message =
      e instanceof ShopifyAdminError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Producten ophalen mislukt.";

    return NextResponse.json(
      {
        error: message,
        detail: e instanceof ShopifyAdminError ? e.detail : undefined,
      },
      { status: e instanceof ShopifyAdminError && e.status ? e.status : 502 }
    );
  }
}
