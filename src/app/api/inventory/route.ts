import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getInventoryStats,
  syncInventoryFromShopify,
  type InventoryCategory,
} from "@/lib/inventory";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const category = request.nextUrl.searchParams.get("category");

    let query = supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .order("title", { ascending: true });

    if (category === "fiets" || category === "onderdeel") {
      query = query.eq("category", category as InventoryCategory);
    }

    const [{ data: products, error }, stats] = await Promise.all([
      query,
      getInventoryStats(supabase, ownerEmail),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { products: products ?? [], stats },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ophalen mislukt." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const result = await syncInventoryFromShopify(supabase, ownerEmail);
    const stats = await getInventoryStats(supabase, ownerEmail);

    return NextResponse.json({ ok: true, ...result, stats });
  } catch (e) {
    const message =
      e instanceof ShopifyAdminError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Synchroniseren mislukt.";

    return NextResponse.json(
      { error: message, detail: e instanceof ShopifyAdminError ? e.detail : undefined },
      { status: 502 }
    );
  }
}
