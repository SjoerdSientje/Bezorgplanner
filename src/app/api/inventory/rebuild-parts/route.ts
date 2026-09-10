import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { rebuildPartsInventoryFromShopifyCollections } from "@/lib/inventory-parts-rebuild";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Herbouw voorraadregels + aftrek-mappings voor collecties onderdelen & accessoires. */
export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const supabase = createServerSupabaseClient();
    const result = await rebuildPartsInventoryFromShopifyCollections(supabase, ownerEmail);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message =
      e instanceof ShopifyAdminError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Rebuild mislukt.";
    console.error("[api/inventory/rebuild-parts]", e);
    return NextResponse.json(
      {
        error: message,
        detail: e instanceof ShopifyAdminError ? e.detail : undefined,
      },
      { status: 502 }
    );
  }
}
