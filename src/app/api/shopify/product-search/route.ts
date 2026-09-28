import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import {
  searchShopifyProductsForOrderForm,
  type ShopifyProductSearchKind,
} from "@/lib/shopify-product-search";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

function parseKind(raw: string | null): ShopifyProductSearchKind | undefined {
  if (raw === "fiets" || raw === "extra") return raw;
  return undefined;
}

/** GET — live Shopify-producten (geen voorraadgroepen) voor orderformulieren. */
export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const kind = parseKind(request.nextUrl.searchParams.get("kind"));

    if (q.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchShopifyProductsForOrderForm(q, 25, kind);

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
