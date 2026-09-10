import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getInventoryStats,
  getInventoryLinkedShopifyProducts,
  syncInventoryFromShopify,
  type InventoryCategory,
} from "@/lib/inventory";
import { countInventoryPendingProducts } from "@/lib/inventory-pending";
import {
  parseIsoDateOnly,
  pushInventoryLevertijdMetafieldsToShopifyProducts,
} from "@/lib/inventory-levertijd";
import { ShopifyAdminError } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";
/** Volledige Shopify-catalogus-sync; nieuwe producten gaan naar de review-wachtrij. */
export const maxDuration = 120;

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

    if (
      category === "fiets" ||
      category === "onderdeel" ||
      category === "accessoire" ||
      category === "overig"
    ) {
      query = query.eq("category", category as InventoryCategory);
    }

    const [{ data: products, error }, stats, pendingCount] = await Promise.all([
      query,
      getInventoryStats(supabase, ownerEmail),
      countInventoryPendingProducts(supabase, ownerEmail).catch(() => 0),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const list = products ?? [];
    const { getReservedQuantitiesByProductIds } = await import(
      "@/lib/inventory-reservations"
    );
    const reservedMap = await getReservedQuantitiesByProductIds(
      supabase,
      ownerEmail,
      list.map((p: { id: string }) => String(p.id))
    );

    const productsWithReserved = list.map((p: { id: string; stock_quantity: number }) => {
      const reserved = reservedMap.get(String(p.id)) ?? 0;
      return {
        ...p,
        reserved_quantity: reserved,
        sellable_quantity: Number(p.stock_quantity ?? 0) - reserved,
      };
    });

    return NextResponse.json(
      { products: productsWithReserved, stats, pendingCount },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ophalen mislukt." },
      { status: 500 }
    );
  }
}

/** Levertijd / restock / opmerking bijwerken en naar Shopify-metafields pushen. */
export async function PATCH(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = await request.json().catch(() => ({}));
    const productId = String(body.productId ?? "").trim();
    if (!productId) {
      return NextResponse.json({ error: "productId is verplicht." }, { status: 400 });
    }

    const updates: {
      levertijd?: string | null;
      restock_datum?: string | null;
      opmerking?: string | null;
    } = {};

    if ("levertijd" in body) {
      const v = body.levertijd == null ? "" : String(body.levertijd).trim();
      updates.levertijd = v || null;
    }
    if ("restock_datum" in body || "restockDatum" in body) {
      const raw = body.restock_datum ?? body.restockDatum;
      if (raw == null || String(raw).trim() === "") {
        updates.restock_datum = null;
      } else {
        const iso = parseIsoDateOnly(String(raw));
        if (!iso) {
          return NextResponse.json(
            { error: "restock_datum moet YYYY-MM-DD zijn." },
            { status: 400 }
          );
        }
        updates.restock_datum = iso;
      }
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

    let shopifyPush: {
      ok: boolean;
      updated?: number;
      failed?: Array<{ shopifyProductId: number; error: string }>;
      detail?: string;
    } | null = null;

    const shouldPushShopify = "levertijd" in updates || "restock_datum" in updates;

    if (shouldPushShopify) {
      try {
        const links = await getInventoryLinkedShopifyProducts(
          supabase,
          ownerEmail,
          productId
        );
        const shopifyProductIds = links.map((l) => l.shopifyProductId);
        // Fallback: alleen hoofd-id als er (nog) geen koppelingen resolven.
        if (shopifyProductIds.length === 0) {
          const head = Number(data.shopify_product_id);
          if (Number.isFinite(head) && head > 0) shopifyProductIds.push(head);
        }

        if (shopifyProductIds.length === 0) {
          shopifyPush = { ok: true, updated: 0, detail: "geen_shopify_producten" };
        } else {
          const result = await pushInventoryLevertijdMetafieldsToShopifyProducts(
            shopifyProductIds,
            {
              levertijd: data.levertijd == null ? null : String(data.levertijd),
              restockDatum:
                data.restock_datum == null ? null : String(data.restock_datum),
            }
          );
          shopifyPush = {
            ok: result.failed.length === 0,
            updated: result.updated,
            failed: result.failed,
            detail:
              result.failed.length === 0
                ? `${result.updated} Shopify-product(en) bijgewerkt`
                : `${result.updated} ok, ${result.failed.length} mislukt`,
          };
        }
      } catch (pushErr) {
        console.error("[api/inventory] Shopify metafield push:", pushErr);
        shopifyPush = {
          ok: false,
          detail:
            pushErr instanceof ShopifyAdminError
              ? pushErr.message
              : pushErr instanceof Error
                ? pushErr.message
                : "Shopify-update mislukt",
        };
      }
    }

    return NextResponse.json({ ok: true, product: data, shopifyPush });
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
    const pendingCount = await countInventoryPendingProducts(supabase, ownerEmail).catch(
      () => 0
    );

    return NextResponse.json({ ok: true, ...result, stats, pendingCount });
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
