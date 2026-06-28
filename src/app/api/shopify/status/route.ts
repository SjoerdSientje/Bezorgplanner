import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import {
  getShopifyAccessTokenInfo,
  getShopifyAdminConfigStatus,
  shopifyAdminJson,
  ShopifyAdminError,
} from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/shopify/status
 * Controleert of Shopify Admin API-credentials werken (handig na app-installatie).
 */
export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);

    const configStatus = getShopifyAdminConfigStatus();
    if (!configStatus.configured) {
      return NextResponse.json(
        {
          configured: false,
          connected: false,
          shopDomain: null,
          missing: configStatus.missing,
          message:
            "Vul SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID en SHOPIFY_CLIENT_SECRET in (Vercel env vars).",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const tokenInfo = await getShopifyAccessTokenInfo();
    const shopData = await shopifyAdminJson<{ shop?: { name?: string; myshopify_domain?: string } }>(
      "/shop.json"
    );

    return NextResponse.json(
      {
        configured: true,
        connected: true,
        shopDomain: configStatus.shopDomain,
        shopName: shopData.shop?.name ?? null,
        myshopifyDomain: shopData.shop?.myshopify_domain ?? configStatus.shopDomain,
        scopes: tokenInfo.scopes,
        tokenExpiresInSeconds: tokenInfo.expiresInSeconds,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const configStatus = getShopifyAdminConfigStatus();
    const message =
      e instanceof ShopifyAdminError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Onbekende fout bij Shopify-verbinding.";

    return NextResponse.json(
      {
        configured: configStatus.configured,
        connected: false,
        shopDomain: configStatus.shopDomain,
        missing: configStatus.missing,
        error: message,
        detail: e instanceof ShopifyAdminError ? e.detail : undefined,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
