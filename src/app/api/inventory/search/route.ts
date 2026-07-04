import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { searchProductsForInventory } from "@/lib/inventory";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = getInventoryOwnerEmail(request);
    const q = request.nextUrl.searchParams.get("q") ?? "";

    if (q.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    const supabase = createServerSupabaseClient();
    const results = await searchProductsForInventory(supabase, ownerEmail, q);

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
