import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { searchShopifyProductsForOrderForm } from "@/lib/shopify-product-search";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

/** GET — live Shopify-producten (geen voorraadgroepen) voor orderformulieren. */
export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const q = request.nextUrl.searchParams.get("q") ?? "";

    if (q.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchShopifyProductsForOrderForm(q);

    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message =
      e instanceof ShopifyAdminError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Zoeken mislukt.";

    return NextResponse.json(
      { error: message, results: [] },
      { status: 502 }
    );
  }
}
