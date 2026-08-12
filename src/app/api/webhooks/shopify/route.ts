import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  passesRitjesFilter,
  mapShopifyOrderToRitjesRow,
  qualifiesForPakketjes,
  pakketjesCustomerName,
  extractPakketjesLineItems,
  shopifyOrderDisplayAdres,
  shopifyOrderCreatedAt,
  type ShopifyOrder,
} from "@/lib/shopify-order";
import {
  allAccountEmails,
  getInventoryScanOwnerEmail,
  shopifyWebhookOrderAppliesToOwner,
} from "@/lib/account";
import { loadProductDefaultItemsRules } from "@/lib/product-rules-server";
import {
  deductInventoryForShopifyOrder,
  restoreInventoryForShopifyOrder,
  removeInventoryProductByShopifyId,
  syncInventoryProductFromShopify,
} from "@/lib/inventory";
import {
  isMoneybirdConfigured,
  removeMoneybirdProductForShopifyId,
  syncSalesInvoiceFromShopifyOrder,
  upsertMoneybirdProductFromShopify,
} from "@/lib/moneybird";
import type { ShopifyAdminProduct } from "@/lib/shopify-admin";
import {
  inferCompletedStatus,
  isOrderMarkedCompleted,
} from "@/lib/order-completion";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function handleProductWebhook(
  topic: string,
  raw: string
): Promise<NextResponse> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const ownerEmail = getInventoryScanOwnerEmail();
  const payload = JSON.parse(raw) as ShopifyAdminProduct & { id?: number };

  if (topic === "products/delete") {
    const productId = Number(payload.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return NextResponse.json({ ok: true, skipped: "missing_product_id" });
    }
    const removed = await removeInventoryProductByShopifyId(
      supabase,
      ownerEmail,
      productId
    );
    let moneybird: { removed: boolean } | { error: string } = { removed: false };
    if (isMoneybirdConfigured()) {
      try {
        const ok = await removeMoneybirdProductForShopifyId(productId);
        moneybird = { removed: ok };
      } catch (mbErr) {
        console.error("[webhooks/shopify] moneybird product delete:", mbErr);
        moneybird = {
          error: mbErr instanceof Error ? mbErr.message : "moneybird delete failed",
        };
      }
    }
    return NextResponse.json({ ok: true, topic, removed, ownerEmail, moneybird });
  }

  if (!payload.id || !payload.title) {
    return NextResponse.json({ ok: true, skipped: "invalid_product_payload" });
  }

  // Ensure variants array exists for group builder.
  const product: ShopifyAdminProduct = {
    ...payload,
    variants: Array.isArray(payload.variants) ? payload.variants : [],
    status: String(payload.status ?? "active"),
    vendor: String(payload.vendor ?? ""),
    product_type: String(payload.product_type ?? ""),
    tags: String(payload.tags ?? ""),
    handle: String(payload.handle ?? ""),
  };

  const result = await syncInventoryProductFromShopify(supabase, ownerEmail, product);

  let moneybird: Record<string, unknown> = { skipped: true };
  if (isMoneybirdConfigured()) {
    try {
      moneybird = await upsertMoneybirdProductFromShopify(product);
    } catch (mbErr) {
      console.error("[webhooks/shopify] moneybird product sync:", mbErr);
      moneybird = {
        error: mbErr instanceof Error ? mbErr.message : "moneybird sync failed",
      };
    }
  }

  return NextResponse.json({ ok: true, topic, ...result, ownerEmail, moneybird });
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const topic = (request.headers.get("x-shopify-topic") ?? "").trim().toLowerCase();

    if (
      topic === "products/create" ||
      topic === "products/update" ||
      topic === "products/delete"
    ) {
      try {
        return await handleProductWebhook(topic, raw);
      } catch (prodErr) {
        console.error("[webhooks/shopify] product sync:", prodErr);
        return NextResponse.json(
          { ok: false, error: prodErr instanceof Error ? prodErr.message : "product sync failed" },
          { status: 200 }
        );
      }
    }

    const order = JSON.parse(raw) as ShopifyOrder;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const shopifyOrderId = String(order.id ?? "").trim();

    // Annulering: voorraad terug, uit ritjes/pakketjes, geen Moneybird-factuur.
    if (order.cancelled_at) {
      try {
        await restoreInventoryForShopifyOrder(supabase, order);
      } catch (invErr) {
        console.error("[webhooks/shopify] inventory restore on cancel:", invErr);
      }

      if (shopifyOrderId) {
        for (const ownerEmail of allAccountEmails()) {
          if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) {
            continue;
          }
          await supabase
            .from("pakketjes_orders")
            .delete()
            .eq("owner_email", ownerEmail)
            .eq("shopify_order_id", shopifyOrderId);
          await supabase
            .from("orders")
            .delete()
            .eq("owner_email", ownerEmail)
            .eq("order_id", shopifyOrderId)
            .eq("source", "shopify");
        }
      }

      return NextResponse.json(
        { ok: true, cancelled: true, shopifyOrderId: shopifyOrderId || null },
        { status: 200 }
      );
    }

    try {
      await deductInventoryForShopifyOrder(supabase, order);
    } catch (invErr) {
      console.error("[webhooks/shopify] inventory deduct:", invErr);
    }

    // Moneybird: create alleen bij orders/create; update alleen concept bij orders/updated.
    if (isMoneybirdConfigured()) {
      try {
        if (topic === "orders/create" || topic === "orders/updated") {
          await syncSalesInvoiceFromShopifyOrder(supabase, order, topic);
        }
      } catch (mbErr) {
        console.error("[webhooks/shopify] moneybird invoice:", mbErr);
      }
    } else {
      console.warn(
        "[webhooks/shopify] Moneybird niet geconfigureerd — factuur overgeslagen (zet MONEYBIRD_ADMINISTRATION_ID, MONEYBIRD_API_TOKEN, MONEYBIRD_TAX_RATE_ID, MONEYBIRD_LEDGER_ACCOUNT_ID)."
      );
    }

    const { data: cutoffRows } = await supabase
      .from("pakketjes_owner_cutoff")
      .select("owner_email, ignore_shopify_created_before");
    const cutoffByOwner = new Map(
      (cutoffRows ?? []).map((r: { owner_email: string; ignore_shopify_created_before: string }) => [
        r.owner_email,
        r.ignore_shopify_created_before,
      ])
    );

    const shopifyOrderIdForPakketjes = String(order.id ?? "").trim();
    const orderCreatedMs = shopifyOrderCreatedAt(order).getTime();

    if (shopifyOrderIdForPakketjes) {
      for (const ownerEmail of allAccountEmails()) {
        if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) {
          await supabase
            .from("pakketjes_orders")
            .delete()
            .eq("owner_email", ownerEmail)
            .eq("shopify_order_id", shopifyOrderIdForPakketjes);
          continue;
        }

        const cutoffIso = cutoffByOwner.get(ownerEmail);
        if (cutoffIso) {
          const cutoffMs = new Date(cutoffIso).getTime();
          if (orderCreatedMs < cutoffMs) {
            await supabase
              .from("pakketjes_orders")
              .delete()
              .eq("owner_email", ownerEmail)
              .eq("shopify_order_id", shopifyOrderIdForPakketjes);
            continue;
          }
        }

        if (qualifiesForPakketjes(order)) {
          const total = parseFloat(String(order.total_price ?? 0));
          const row = {
            owner_email: ownerEmail,
            shopify_order_id: shopifyOrderIdForPakketjes,
            order_nummer: String(order.name ?? ""),
            naam: pakketjesCustomerName(order),
            adres: shopifyOrderDisplayAdres(order),
            items: extractPakketjesLineItems(order),
            totaal_prijs: total,
            fulfillment_status: order.fulfillment_status ?? null,
          };
          const { error: pErr } = await supabase.from("pakketjes_orders").upsert(row, {
            onConflict: "owner_email,shopify_order_id",
          });
          if (pErr) {
            console.error("[webhooks/shopify] pakketjes upsert:", pErr.message);
          }
        } else {
          await supabase
            .from("pakketjes_orders")
            .delete()
            .eq("owner_email", ownerEmail)
            .eq("shopify_order_id", shopifyOrderIdForPakketjes);
        }
      }
    }

    if (!passesRitjesFilter(order)) {
      return NextResponse.json({ ok: true, skipped: "ritjes_filter" }, { status: 200 });
    }

    const insertedOrUpdatedIds: string[] = [];
    for (const ownerEmail of allAccountEmails()) {
      if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) {
        continue;
      }
      const productRules = await loadProductDefaultItemsRules(supabase, ownerEmail);
      const row = mapShopifyOrderToRitjesRow(order, productRules);

      const { data: existing } = await supabase
        .from("orders")
        .select("id, status, afgerond_at, mp_tags, order_nummer")
        .eq("owner_email", ownerEmail)
        .eq("order_id", row.order_id)
        .eq("source", "shopify")
        .maybeSingle();

      const insertRow = {
        owner_email: ownerEmail,
        source: row.source,
        type: row.type,
        status: row.status,
        order_nummer: row.order_nummer,
        naam: row.naam,
        adres_url: row.adres_url,
        bel_link: row.bel_link,
        bezorgtijd_voorkeur: row.bezorgtijd_voorkeur,
        meenemen_in_planning: row.meenemen_in_planning,
        nieuw_appje_sturen: row.nieuw_appje_sturen,
        datum_opmerking: row.datum_opmerking,
        opmerkingen_klant: row.opmerkingen_klant,
        producten: row.producten,
        bestelling_totaal_prijs: row.bestelling_totaal_prijs,
        betaald: row.betaald,
        volledig_adres: row.volledig_adres,
        telefoon_nummer: row.telefoon_nummer,
        order_id: row.order_id,
        datum: row.datum,
        aantal_fietsen: row.aantal_fietsen,
        email: row.email,
        telefoon_e164: row.telefoon_e164,
        model: row.model,
        serienummer: row.serienummer,
        mp_tags: row.mp_tags,
        line_items_json: row.line_items_json,
      };

      if (existing) {
        if (isOrderMarkedCompleted(existing)) {
          if (String(existing.status ?? "") === "ritjes_vandaag" && existing.afgerond_at) {
            await supabase
              .from("orders")
              .update({ status: inferCompletedStatus(existing) })
              .eq("id", existing.id);
          }
          continue;
        }
        await supabase.from("orders").update(insertRow).eq("id", existing.id);
        insertedOrUpdatedIds.push(existing.id);
        continue;
      }

      let inserted: { id: string } | null = null;
      let insertError = null;
      const { data: d1, error: e1 } = await supabase
        .from("orders")
        .insert(insertRow)
        .select("id")
        .single();

      if (e1) {
        console.error("[webhooks/shopify] Supabase insert error:", e1.message);
        if (e1.message?.includes("line_items_json")) {
          const { line_items_json: _omit, ...rowWithoutJson } = insertRow;
          const { data: d2, error: e2 } = await supabase
            .from("orders")
            .insert(rowWithoutJson)
            .select("id")
            .single();
          inserted = d2;
          insertError = e2;
        } else {
          insertError = e1;
        }
      } else {
        inserted = d1;
      }

      if (insertError) {
        console.error("[webhooks/shopify] Definitieve insert-fout:", insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      if (inserted?.id) insertedOrUpdatedIds.push(inserted.id);
    }

    return NextResponse.json({ ok: true, ids: insertedOrUpdatedIds }, { status: 200 });
  } catch (e) {
    console.error("[webhooks/shopify]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
