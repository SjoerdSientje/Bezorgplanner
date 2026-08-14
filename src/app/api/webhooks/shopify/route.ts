import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  passesRitjesFilter,
  mapShopifyOrderToRitjesRow,
  qualifiesForPakketjes,
  pakketjesCustomerName,
  extractPakketjesLineItems,
  shopifyOrderDisplayAdres,
  shopifyOrderCreatedAt,
  ritjesShopifyRelevantFieldsEqual,
  pakketjesShopifyRelevantFieldsEqual,
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
  syncInventoryForShopifyOrderUpdate,
  removeInventoryProductByShopifyId,
  syncInventoryProductFromShopify,
} from "@/lib/inventory";
import { syncInventoryLevertijdForShopifyProduct } from "@/lib/inventory-levertijd";
import {
  isMoneybirdConfigured,
  removeMoneybirdProductForShopifyId,
  syncSalesInvoiceFromShopifyOrder,
  deleteSalesInvoiceForShopifyOrderId,
  upsertMoneybirdProductFromShopify,
} from "@/lib/moneybird";
import type { ShopifyAdminProduct } from "@/lib/shopify-admin";
import {
  inferCompletedStatus,
  isOrderMarkedCompleted,
} from "@/lib/order-completion";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
      productId,
      {
        title: typeof payload.title === "string" ? payload.title : null,
        variantIds: Array.isArray(payload.variants)
          ? payload.variants.map((v) => Number(v.id)).filter((id) => Number.isFinite(id) && id > 0)
          : [],
      }
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

  try {
    const lever = await syncInventoryLevertijdForShopifyProduct(
      supabase,
      ownerEmail,
      Number(product.id)
    );
    if (lever.updated) {
      console.info(
        "[webhooks/shopify] levertijd bijgewerkt",
        product.id,
        lever.next
      );
    }
  } catch (leverErr) {
    console.error("[webhooks/shopify] levertijd metafield sync:", leverErr);
  }

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

/**
 * Verwijder Shopify-order uit ritjes, pakketjes, Moneybird (+ voorraad terugzetten).
 * Gebruikt bij annulering én orders/deleted.
 */
async function removeShopifyOrderEverywhere(
  supabase: SupabaseClient,
  shopifyOrderId: string,
  orderForInventory: ShopifyOrder | null
): Promise<void> {
  // orders/deleted stuurt vaak alleen { id }. Haal naam/line items uit DB voor correcte restore.
  let orderPayload: ShopifyOrder | null = orderForInventory;
  if (!orderPayload?.name || !(orderPayload.line_items?.length)) {
    const { data: dbOrder } = await supabase
      .from("orders")
      .select("order_nummer, line_items_json, producten")
      .eq("order_id", shopifyOrderId)
      .eq("source", "shopify")
      .limit(1)
      .maybeSingle();

    if (dbOrder) {
      const synthetic: ShopifyOrder = {
        id: shopifyOrderId,
        name: String(dbOrder.order_nummer ?? shopifyOrderId),
        line_items: [],
      };
      try {
        const parsed = JSON.parse(String(dbOrder.line_items_json ?? "[]"));
        if (Array.isArray(parsed)) {
          synthetic.line_items = parsed.map((li: { name?: string; quantity?: number }) => ({
            name: String(li.name ?? ""),
            quantity: Math.max(1, Number(li.quantity ?? 1) || 1),
          }));
        }
      } catch {
        // ignore
      }
      if (!synthetic.line_items?.length && dbOrder.producten) {
        synthetic.line_items = String(dbOrder.producten)
          .split("\n")
          .map((n) => n.trim())
          .filter(Boolean)
          .map((name) => ({ name, quantity: 1 }));
      }
      orderPayload = {
        ...synthetic,
        ...(orderForInventory ?? {}),
        id: shopifyOrderId,
        name: orderForInventory?.name ?? synthetic.name,
        line_items: orderForInventory?.line_items?.length
          ? orderForInventory.line_items
          : synthetic.line_items,
      };
    }
  }

  if (orderPayload) {
    try {
      await restoreInventoryForShopifyOrder(supabase, orderPayload);
    } catch (invErr) {
      console.error("[webhooks/shopify] inventory restore:", invErr);
    }
  }

  if (isMoneybirdConfigured()) {
    try {
      await deleteSalesInvoiceForShopifyOrderId(shopifyOrderId);
    } catch (mbErr) {
      console.error("[webhooks/shopify] moneybird invoice delete:", mbErr);
    }
  }

  for (const ownerEmail of allAccountEmails()) {
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

  await supabase
    .from("moneybird_shopify_invoice_locks")
    .delete()
    .eq("shopify_order_id", shopifyOrderId);
}

type RitjesInsertRow = ReturnType<typeof mapShopifyOrderToRitjesRow> & {
  owner_email: string;
};

async function insertRitjesRow(
  supabase: SupabaseClient,
  insertRow: RitjesInsertRow
): Promise<string | null> {
  const { data: d1, error: e1 } = await supabase
    .from("orders")
    .insert(insertRow)
    .select("id")
    .single();

  if (!e1) return d1?.id ?? null;

  console.error("[webhooks/shopify] Supabase insert error:", e1.message);
  if (e1.message?.includes("line_items_json")) {
    const { line_items_json: _omit, ...rowWithoutJson } = insertRow;
    const { data: d2, error: e2 } = await supabase
      .from("orders")
      .insert(rowWithoutJson)
      .select("id")
      .single();
    if (e2) {
      console.error("[webhooks/shopify] Definitieve insert-fout:", e2);
      throw new Error(e2.message);
    }
    return d2?.id ?? null;
  }
  throw new Error(e1.message);
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
    const isCreate = topic === "orders/create";
    const isUpdate = topic === "orders/updated";
    const isDelete = topic === "orders/deleted" || topic === "orders/delete";

    // Verwijderen / annuleren
    if (isDelete || Boolean(order.cancelled_at)) {
      if (!shopifyOrderId) {
        return NextResponse.json({ ok: true, skipped: "missing_order_id" }, { status: 200 });
      }
      await removeShopifyOrderEverywhere(
        supabase,
        shopifyOrderId,
        isDelete && !order.line_items ? null : order
      );
      return NextResponse.json(
        {
          ok: true,
          deleted: true,
          reason: isDelete ? "orders/deleted" : "cancelled",
          shopifyOrderId,
        },
        { status: 200 }
      );
    }

    if (!isCreate && !isUpdate) {
      return NextResponse.json({ ok: true, skipped: "unhandled_topic", topic }, { status: 200 });
    }

    // Voorraad: create = aftrekken; update = hersync (terug + opnieuw); delete/cancel = restore.
    try {
      if (isCreate) {
        await deductInventoryForShopifyOrder(supabase, order);
      } else if (isUpdate) {
        await syncInventoryForShopifyOrderUpdate(supabase, order);
      }
    } catch (invErr) {
      console.error("[webhooks/shopify] inventory:", invErr);
    }

    // Moneybird: create alleen bij create; draft-update alleen bij update (bestaande factuur).
    if (isMoneybirdConfigured()) {
      try {
        await syncSalesInvoiceFromShopifyOrder(supabase, order, topic);
      } catch (mbErr) {
        console.error("[webhooks/shopify] moneybird invoice:", mbErr);
      }
    } else {
      console.warn(
        "[webhooks/shopify] Moneybird niet geconfigureerd — factuur overgeslagen (zet MONEYBIRD_ADMINISTRATION_ID, MONEYBIRD_API_TOKEN, MONEYBIRD_TAX_RATE_ID, MONEYBIRD_LEDGER_ACCOUNT_ID)."
      );
    }

    // ── Pakketjes ──────────────────────────────────────────────────────────
    const { data: cutoffRows } = await supabase
      .from("pakketjes_owner_cutoff")
      .select("owner_email, ignore_shopify_created_before");
    const cutoffByOwner = new Map(
      (cutoffRows ?? []).map((r: { owner_email: string; ignore_shopify_created_before: string }) => [
        r.owner_email,
        r.ignore_shopify_created_before,
      ])
    );
    const orderCreatedMs = shopifyOrderCreatedAt(order).getTime();

    if (shopifyOrderId) {
      for (const ownerEmail of allAccountEmails()) {
        if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) {
          continue;
        }

        const cutoffIso = cutoffByOwner.get(ownerEmail);
        if (cutoffIso && orderCreatedMs < new Date(cutoffIso).getTime()) {
          continue;
        }

        const { data: existingPakket } = await supabase
          .from("pakketjes_orders")
          .select("id, order_nummer, naam, adres, items, totaal_prijs, fulfillment_status")
          .eq("owner_email", ownerEmail)
          .eq("shopify_order_id", shopifyOrderId)
          .maybeSingle();

        if (qualifiesForPakketjes(order)) {
          const total = parseFloat(String(order.total_price ?? 0));
          const row = {
            owner_email: ownerEmail,
            shopify_order_id: shopifyOrderId,
            order_nummer: String(order.name ?? ""),
            naam: pakketjesCustomerName(order),
            adres: shopifyOrderDisplayAdres(order),
            items: extractPakketjesLineItems(order),
            totaal_prijs: total,
            fulfillment_status: order.fulfillment_status ?? null,
          };

          if (isCreate) {
            const { error: pErr } = await supabase.from("pakketjes_orders").upsert(row, {
              onConflict: "owner_email,shopify_order_id",
            });
            if (pErr) console.error("[webhooks/shopify] pakketjes upsert:", pErr.message);
          } else if (existingPakket?.id) {
            // Update: alleen als de pakketjes-rij al bestaat én Shopify-data wijzigt.
            if (pakketjesShopifyRelevantFieldsEqual(existingPakket, row)) {
              continue;
            }
            const { error: pErr } = await supabase
              .from("pakketjes_orders")
              .update({
                order_nummer: row.order_nummer,
                naam: row.naam,
                adres: row.adres,
                items: row.items,
                totaal_prijs: row.totaal_prijs,
                fulfillment_status: row.fulfillment_status,
              })
              .eq("id", existingPakket.id);
            if (pErr) console.error("[webhooks/shopify] pakketjes update:", pErr.message);
          }
        } else if (existingPakket?.id) {
          // Voldoet niet meer → verwijderen (alleen als rij al bestond).
          await supabase.from("pakketjes_orders").delete().eq("id", existingPakket.id);
        }
      }
    }

    // ── Ritjes ─────────────────────────────────────────────────────────────
    const insertedOrUpdatedIds: string[] = [];

    for (const ownerEmail of allAccountEmails()) {
      if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) {
        continue;
      }

      const productRules = await loadProductDefaultItemsRules(supabase, ownerEmail);
      const row = mapShopifyOrderToRitjesRow(order, productRules);
      if (!row.order_id) continue;

      const { data: existing } = await supabase
        .from("orders")
        .select(
          "id, status, afgerond_at, mp_tags, order_nummer, type, naam, adres_url, bel_link, bezorgtijd_voorkeur, meenemen_in_planning, datum_opmerking, opmerkingen_klant, producten, bestelling_totaal_prijs, betaald, volledig_adres, telefoon_nummer, datum, aantal_fietsen, email, telefoon_e164, line_items_json"
        )
        .eq("owner_email", ownerEmail)
        .eq("order_id", row.order_id)
        .eq("source", "shopify")
        .maybeSingle();

      const insertRow: RitjesInsertRow = {
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

      // UPDATE-pad: alleen als de order al in de bezorgplanner staat.
      if (isUpdate) {
        if (!existing) {
          continue;
        }
        if (isOrderMarkedCompleted(existing)) {
          if (String(existing.status ?? "") === "ritjes_vandaag" && existing.afgerond_at) {
            await supabase
              .from("orders")
              .update({ status: inferCompletedStatus(existing) })
              .eq("id", existing.id);
          }
          continue;
        }

        if (!passesRitjesFilter(order)) {
          // Voldoet niet meer → uit ritjes (planning_slots cascaden mee).
          await supabase.from("orders").delete().eq("id", existing.id);
          continue;
        }

        const { data: activeSlot } = await supabase
          .from("planning_slots")
          .select("id")
          .eq("owner_email", ownerEmail)
          .eq("order_id", existing.id)
          .neq("status", "afgerond")
          .limit(1)
          .maybeSingle();

        const includePlannerScheduleFields = !activeSlot?.id;
        if (
          ritjesShopifyRelevantFieldsEqual(existing, row, {
            includePlannerScheduleFields,
          })
        ) {
          continue;
        }

        if (activeSlot?.id) {
          const {
            status: _s,
            meenemen_in_planning: _m,
            datum_opmerking: _d,
            nieuw_appje_sturen: _n,
            datum: _datum,
            model: _model,
            serienummer: _serienummer,
            ...safeUpdate
          } = insertRow;
          await supabase.from("orders").update(safeUpdate).eq("id", existing.id);
        } else {
          await supabase.from("orders").update(insertRow).eq("id", existing.id);
        }
        insertedOrUpdatedIds.push(existing.id);
        continue;
      }

      // CREATE-pad: nieuwe rij (of update als create-webhook opnieuw komt).
      if (!passesRitjesFilter(order)) {
        continue;
      }

      if (existing) {
        if (isOrderMarkedCompleted(existing)) continue;
        await supabase.from("orders").update(insertRow).eq("id", existing.id);
        insertedOrUpdatedIds.push(existing.id);
        continue;
      }

      const insertedId = await insertRitjesRow(supabase, insertRow);
      if (insertedId) insertedOrUpdatedIds.push(insertedId);
    }

    return NextResponse.json(
      { ok: true, topic, ids: insertedOrUpdatedIds },
      { status: 200 }
    );
  } catch (e) {
    console.error("[webhooks/shopify]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
