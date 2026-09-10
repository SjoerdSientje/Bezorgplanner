import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { applyPendingInventoryProduct } from "@/lib/inventory-pending";
import { fetchShopifyProductById, ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const { id: pendingId } = await context.params;
    if (!pendingId) {
      return NextResponse.json({ error: "id is verplicht." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "link_existing" ? "link_existing" : "new_rule";
    const supabase = createServerSupabaseClient();

    if (mode === "link_existing") {
      const inventoryProductId = String(body.inventoryProductId ?? "").trim();
      if (!inventoryProductId) {
        return NextResponse.json(
          { error: "inventoryProductId is verplicht bij koppelen." },
          { status: 400 }
        );
      }
      const result = await applyPendingInventoryProduct(supabase, ownerEmail, pendingId, {
        mode: "link_existing",
        inventoryProductId,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const stockQuantity = Math.floor(Number(body.stockQuantity ?? body.stock_quantity));
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
      return NextResponse.json(
        { error: "stockQuantity is verplicht bij een nieuwe voorraadregel." },
        { status: 400 }
      );
    }

    const { data: pending } = await supabase
      .from("inventory_pending_products")
      .select("shopify_product_id, title")
      .eq("owner_email", ownerEmail)
      .eq("id", pendingId)
      .maybeSingle();

    let product = null;
    if (pending?.shopify_product_id) {
      try {
        product = await fetchShopifyProductById(Number(pending.shopify_product_id));
      } catch (err) {
        console.warn(
          "[pending-products/resolve] Shopify fetch:",
          err instanceof Error ? err.message : err
        );
      }
    }

    const result = await applyPendingInventoryProduct(supabase, ownerEmail, pendingId, {
      mode: "new_rule",
      title: body.title != null ? String(body.title) : pending?.title,
      stockQuantity,
      product,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message =
      e instanceof ShopifyAdminError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Oplossen mislukt.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
