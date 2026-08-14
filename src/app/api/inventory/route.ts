import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getInventoryStats,
  syncInventoryFromShopify,
  type InventoryCategory,
} from "@/lib/inventory";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";
/** Volledige Shopify-catalogus-sync kan >10s duren. */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const supabase = createServerSupabaseClient();
    const category = request.nextUrl.searchParams.get("category");

    let query = supabase
      .from("inventory_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .order("title", { ascending: true });

    if (category === "fiets" || category === "onderdeel" || category === "overig") {
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

/** Levertijd / opmerking bijwerken (blijft behouden bij Shopify-sync). */
export async function PATCH(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = await request.json().catch(() => ({}));
    const productId = String(body.productId ?? "").trim();
    if (!productId) {
      return NextResponse.json({ error: "productId is verplicht." }, { status: 400 });
    }

    const updates: { levertijd?: string | null; opmerking?: string | null } = {};
    if ("levertijd" in body) {
      const v = body.levertijd == null ? "" : String(body.levertijd).trim();
      updates.levertijd = v || null;
    }
    if ("opmerking" in body) {
      const v = body.opmerking == null ? "" : String(body.opmerking).trim();
      updates.opmerking = v || null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Geen velden om bij te werken." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("inventory_products")
      .update(updates)
      .eq("id", productId)
      .eq("owner_email", ownerEmail)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Product niet gevonden." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, product: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bijwerken mislukt." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
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

    console.error("[api/inventory] sync failed:", e);

    return NextResponse.json(
      {
        error: message,
        detail: e instanceof ShopifyAdminError ? e.detail : undefined,
      },
      { status: 502 }
    );
  }
}
