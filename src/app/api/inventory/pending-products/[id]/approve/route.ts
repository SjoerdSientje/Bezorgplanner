import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  applyPendingInventoryProduct,
  type PendingAiSuggestion,
} from "@/lib/inventory-pending";
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
    const supabase = createServerSupabaseClient();

    const { data: pending, error } = await supabase
      .from("inventory_pending_products")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("id", pendingId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!pending) {
      return NextResponse.json({ error: "Pending product niet gevonden." }, { status: 404 });
    }

    const suggestion = (pending.ai_suggestion ?? null) as PendingAiSuggestion | null;
    const mode =
      suggestion?.type === "link_existing" ? "link_existing" : "new_rule";

    if (mode === "link_existing") {
      const targetId = String(suggestion?.inventoryProductId ?? "").trim();
      if (!targetId) {
        return NextResponse.json(
          { error: "AI-suggestie mist een bestaande voorraadregel om te koppelen." },
          { status: 400 }
        );
      }
      const result = await applyPendingInventoryProduct(supabase, ownerEmail, pendingId, {
        mode: "link_existing",
        inventoryProductId: targetId,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const stockRaw = body.stockQuantity ?? body.stock_quantity;
    const stockQuantity = Math.floor(Number(stockRaw));
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
      return NextResponse.json(
        { error: "stockQuantity is verplicht bij een nieuwe voorraadregel." },
        { status: 400 }
      );
    }

    let product = null;
    try {
      product = await fetchShopifyProductById(Number(pending.shopify_product_id));
    } catch (err) {
      console.warn(
        "[pending-products/approve] Shopify fetch:",
        err instanceof Error ? err.message : err
      );
    }

    const result = await applyPendingInventoryProduct(supabase, ownerEmail, pendingId, {
      mode: "new_rule",
      title: suggestion?.suggestedTitle ?? pending.title,
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
          : "Goedkeuren mislukt.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
