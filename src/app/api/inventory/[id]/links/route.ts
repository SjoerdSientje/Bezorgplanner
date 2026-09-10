import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getInventoryLinkedShopifyProducts } from "@/lib/inventory";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Shopify-producten gekoppeld aan één voorraadregel (deals / sets / unit-maps). */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const { id } = await context.params;
    const productId = String(id ?? "").trim();
    if (!productId) {
      return NextResponse.json({ error: "id is verplicht." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const links = await getInventoryLinkedShopifyProducts(
      supabase,
      ownerEmail,
      productId
    );

    return NextResponse.json(
      { links },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message =
      e instanceof ShopifyAdminError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Koppelingen ophalen mislukt.";
    const status =
      e instanceof Error && e.message === "Voorraadregel niet gevonden."
        ? 404
        : e instanceof ShopifyAdminError
          ? 502
          : 500;
    return NextResponse.json({ error: message, links: [] }, { status });
  }
}
