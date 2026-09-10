/**
 * Voorraadreserveringen: geplande Shopify/MP-bezorgorders houden stock vast
 * zonder meteen af te schrijven. Commit = echte aftrek + reservering wissen.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allAccountEmails,
  getInventoryScanOwnerEmail,
  shopifyWebhookOrderAppliesToOwner,
} from "@/lib/account";
import { normalizeEmail } from "@/lib/auth-shared";
import {
  applyInventoryMutation,
  buildInventoryDeductionLineItems,
  clearOrderDeduction,
  desiredDeductionByProduct,
  hasOrderDeduction,
  markOrderDeducted,
  type LineItemForDeduction,
  LOW_STOCK_THRESHOLD,
} from "@/lib/inventory";
import { AUTO_FINALIZE_INVOICE_BELOW_EUR, shopifyOrderBillableTotalIncl } from "@/lib/moneybird";
import { loadProductDefaultItemsRules } from "@/lib/product-rules-server";
import type { ShopifyOrder } from "@/lib/shopify-order";

export type InventoryReservationSource = "shopify" | "marktplaats";

export type InventoryReservationRow = {
  id: string;
  owner_email: string;
  inventory_product_id: string;
  quantity: number;
  source: InventoryReservationSource;
  external_order_id: string;
  order_db_id: string | null;
  order_nummer: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryReservationOrderView = {
  reservationId: string;
  quantity: number;
  source: InventoryReservationSource;
  externalOrderId: string;
  orderDbId: string | null;
  orderNummer: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /** Live uit orders (ritjes): bezorgtijd_voorkeur of datum. */
  voorkeursdatum: string | null;
};

function moneybirdInvoiceOwnerEmail(): string {
  const fromEnv = process.env.MONEYBIRD_INVOICE_OWNER_EMAIL?.trim();
  if (fromEnv) return normalizeEmail(fromEnv);
  return getInventoryScanOwnerEmail();
}

export async function sumReservedForProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  inventoryProductId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("inventory_reservations")
    .select("quantity")
    .eq("owner_email", ownerEmail)
    .eq("inventory_product_id", inventoryProductId);
  if (error) {
    console.error("[inventory-reservations] sum:", error.message);
    return 0;
  }
  return (data ?? []).reduce(
    (sum, row) => sum + Math.max(0, Math.floor(Number(row.quantity ?? 0))),
    0
  );
}

export async function getReservedQuantitiesByProductIds(
  supabase: SupabaseClient,
  ownerEmail: string,
  productIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = productIds.filter(Boolean);
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from("inventory_reservations")
    .select("inventory_product_id, quantity")
    .eq("owner_email", ownerEmail)
    .in("inventory_product_id", ids);
  if (error) {
    console.error("[inventory-reservations] batch sum:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    const id = String(row.inventory_product_id);
    out.set(id, (out.get(id) ?? 0) + Math.max(0, Math.floor(Number(row.quantity ?? 0))));
  }
  return out;
}

export function sellableFrom(stock: number, reserved: number): number {
  return Math.floor(Number(stock) || 0) - Math.max(0, Math.floor(Number(reserved) || 0));
}

/** WhatsApp-alert wanneer verkoopbare voorraad 3 of ≤0 raakt. */
export async function maybeNotifySellableStockAlert(params: {
  productTitle: string;
  beforeSellable: number;
  afterSellable: number;
}): Promise<void> {
  const before = params.beforeSellable;
  const after = params.afterSellable;
  const hitThree =
    after === LOW_STOCK_THRESHOLD && before !== LOW_STOCK_THRESHOLD && before > LOW_STOCK_THRESHOLD;
  const hitZero = after <= 0 && before > 0;
  if (!hitThree && !hitZero) return;

  try {
    const { notifyInventoryStockAlert } = await import("@/lib/whatsapp");
    const wa = await notifyInventoryStockAlert({
      productTitle: params.productTitle || "Product",
      stockAfter: after <= 0 ? 0 : after,
    });
    if (!wa.ok) {
      console.warn("[inventory-reservations] voorraad-alert WhatsApp mislukt:", wa.error);
    }
  } catch (e) {
    console.warn("[inventory-reservations] voorraad-alert WhatsApp fout:", e);
  }
}

async function alertSellableForProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  inventoryProductId: string,
  beforeReserved: number,
  afterReserved: number
): Promise<void> {
  const { data: product } = await supabase
    .from("inventory_products")
    .select("title, variant_title, stock_quantity")
    .eq("owner_email", ownerEmail)
    .eq("id", inventoryProductId)
    .maybeSingle();
  if (!product) return;
  const stock = Number(product.stock_quantity ?? 0);
  const beforeSellable = sellableFrom(stock, beforeReserved);
  const afterSellable = sellableFrom(stock, afterReserved);
  const variant = String(product.variant_title ?? "").trim();
  const productTitle = variant
    ? `${String(product.title ?? "").trim()} (${variant})`
    : String(product.title ?? "").trim();
  await maybeNotifySellableStockAlert({ productTitle, beforeSellable, afterSellable });
}

type ReservationMeta = {
  orderDbId?: string | null;
  orderNummer?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
};

/**
 * Zet reserveringen voor een order gelijk aan de gewenste aftrek (replace).
 * Roept geen echte voorraadaftrek aan.
 */
export async function syncReservationsForOrder(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    source: InventoryReservationSource;
    externalOrderId: string;
    lineItems: LineItemForDeduction[];
    meta?: ReservationMeta;
  }
): Promise<{ reserved: number }> {
  const { ownerEmail, source, externalOrderId, lineItems } = params;
  const desired = await desiredDeductionByProduct(supabase, ownerEmail, lineItems);

  const { data: existingRows } = await supabase
    .from("inventory_reservations")
    .select("id, inventory_product_id, quantity")
    .eq("owner_email", ownerEmail)
    .eq("source", source)
    .eq("external_order_id", externalOrderId);

  const existingByProduct = new Map<string, { id: string; quantity: number }>();
  for (const row of existingRows ?? []) {
    existingByProduct.set(String(row.inventory_product_id), {
      id: String(row.id),
      quantity: Math.max(0, Math.floor(Number(row.quantity ?? 0))),
    });
  }

  const touched = Array.from(
    new Set([...Array.from(desired.keys()), ...Array.from(existingByProduct.keys())])
  );

  let reservedTotal = 0;
  const meta = params.meta ?? {};

  for (const productId of touched) {
    const beforeQty = existingByProduct.get(productId)?.quantity ?? 0;
    const afterQty = desired.get(productId) ?? 0;
    reservedTotal += afterQty;

    if (afterQty <= 0) {
      if (existingByProduct.has(productId)) {
        await supabase
          .from("inventory_reservations")
          .delete()
          .eq("owner_email", ownerEmail)
          .eq("source", source)
          .eq("external_order_id", externalOrderId)
          .eq("inventory_product_id", productId);
        await alertSellableForProduct(supabase, ownerEmail, productId, beforeQty, 0);
      }
      continue;
    }

    const payload = {
      owner_email: ownerEmail,
      inventory_product_id: productId,
      quantity: afterQty,
      source,
      external_order_id: externalOrderId,
      order_db_id: meta.orderDbId ?? null,
      order_nummer: meta.orderNummer ?? null,
      customer_name: meta.customerName ?? null,
      customer_phone: meta.customerPhone ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("inventory_reservations").upsert(payload, {
      onConflict: "owner_email,source,external_order_id,inventory_product_id",
    });
    if (error) {
      console.error("[inventory-reservations] upsert:", error.message);
      continue;
    }
    if (beforeQty !== afterQty) {
      await alertSellableForProduct(supabase, ownerEmail, productId, beforeQty, afterQty);
    }
  }

  return { reserved: reservedTotal };
}

export async function clearReservationsForOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  source: InventoryReservationSource,
  externalOrderId: string,
  options?: { skipAlerts?: boolean }
): Promise<number> {
  const { data: existing } = await supabase
    .from("inventory_reservations")
    .select("inventory_product_id, quantity")
    .eq("owner_email", ownerEmail)
    .eq("source", source)
    .eq("external_order_id", externalOrderId);

  const { error } = await supabase
    .from("inventory_reservations")
    .delete()
    .eq("owner_email", ownerEmail)
    .eq("source", source)
    .eq("external_order_id", externalOrderId);
  if (error) {
    console.error("[inventory-reservations] clear:", error.message);
    return 0;
  }

  if (!options?.skipAlerts) {
    for (const row of existing ?? []) {
      const productId = String(row.inventory_product_id);
      const beforeQty = Math.max(0, Math.floor(Number(row.quantity ?? 0)));
      await alertSellableForProduct(supabase, ownerEmail, productId, beforeQty, 0);
    }
  }
  return existing?.length ?? 0;
}

/**
 * Echte voorraadaftrek + reserveringen wissen + deduction-mark.
 * Idempotent via inventory_order_deductions.
 */
export async function commitReservationsForOrder(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    source: InventoryReservationSource;
    externalOrderId: string;
    orderReference: string;
    /** Fallback als er geen reserveringsrijen (meer) zijn. */
    lineItemsFallback?: LineItemForDeduction[];
  }
): Promise<{ committed: boolean; skippedReason?: string }> {
  const { ownerEmail, source, externalOrderId, orderReference } = params;

  const already = await hasOrderDeduction(supabase, ownerEmail, source, externalOrderId);
  if (already) {
    await clearReservationsForOrder(supabase, ownerEmail, source, externalOrderId);
    return { committed: false, skippedReason: "already_deducted" };
  }

  const { data: reservationRows } = await supabase
    .from("inventory_reservations")
    .select("inventory_product_id, quantity")
    .eq("owner_email", ownerEmail)
    .eq("source", source)
    .eq("external_order_id", externalOrderId);

  const qtyByProduct = new Map<string, number>();
  for (const row of reservationRows ?? []) {
    const id = String(row.inventory_product_id);
    qtyByProduct.set(
      id,
      (qtyByProduct.get(id) ?? 0) + Math.max(0, Math.floor(Number(row.quantity ?? 0)))
    );
  }

  if (qtyByProduct.size === 0 && params.lineItemsFallback?.length) {
    const desired = await desiredDeductionByProduct(
      supabase,
      ownerEmail,
      params.lineItemsFallback
    );
    for (const [id, qty] of Array.from(desired.entries())) qtyByProduct.set(id, qty);
  }

  if (qtyByProduct.size === 0) {
    return { committed: false, skippedReason: "nothing_to_commit" };
  }

  const isNew = await markOrderDeducted(supabase, ownerEmail, source, externalOrderId);
  if (!isNew) {
    await clearReservationsForOrder(supabase, ownerEmail, source, externalOrderId);
    return { committed: false, skippedReason: "already_deducted" };
  }

  const orderProducten = Array.from(qtyByProduct.entries())
    .map(([id, qty]) => `${qty}x ${id}`)
    .join("\n");

  for (const [productId, quantity] of Array.from(qtyByProduct.entries())) {
    if (quantity <= 0) continue;
    await applyInventoryMutation(supabase, {
      ownerEmail,
      productId,
      mutationType: "uitgaand",
      quantity,
      source,
      note: `Aftrek bij levering/factuur order ${orderReference}`,
      orderReference,
      orderProducten,
      skipStockAlert: true,
    });
  }

  await clearReservationsForOrder(supabase, ownerEmail, source, externalOrderId, {
    skipAlerts: true,
  });
  return { committed: true };
}

function shopifyCustomerPhone(order: ShopifyOrder): string | null {
  const raw =
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    order.customer?.phone ||
    order.phone ||
    null;
  const s = String(raw ?? "").trim();
  return s || null;
}

function shopifyCustomerName(order: ShopifyOrder): string | null {
  const fn = String(order.customer?.first_name ?? "").trim();
  const ln = String(order.customer?.last_name ?? "").trim();
  const name = [fn, ln].filter(Boolean).join(" ").trim();
  if (name) return name;
  const shipping = order.shipping_address;
  const line = [shipping?.address1, shipping?.city].filter(Boolean).join(", ").trim();
  return line || null;
}

async function findShopifyOrderDbId(
  supabase: SupabaseClient,
  ownerEmail: string,
  shopifyOrderId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("orders")
    .select("id")
    .eq("owner_email", ownerEmail)
    .eq("order_id", shopifyOrderId)
    .eq("source", "shopify")
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function reserveInventoryForShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;
  const rawItems = order.line_items ?? [];
  if (rawItems.length === 0) return;

  const orderReference = String(order.name ?? shopifyOrderId);

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    if (await hasOrderDeduction(supabase, ownerEmail, "shopify", shopifyOrderId)) {
      continue;
    }

    const rules = await loadProductDefaultItemsRules(supabase, ownerEmail);
    const lineItems = buildInventoryDeductionLineItems(rawItems, rules);
    const orderDbId = await findShopifyOrderDbId(supabase, ownerEmail, shopifyOrderId);

    await syncReservationsForOrder(supabase, {
      ownerEmail,
      source: "shopify",
      externalOrderId: shopifyOrderId,
      lineItems,
      meta: {
        orderDbId,
        orderNummer: orderReference,
        customerName: shopifyCustomerName(order),
        customerPhone: shopifyCustomerPhone(order),
      },
    });

    console.info(
      "[inventory-reservations] Shopify create — gereserveerd",
      orderReference,
      ownerEmail
    );
  }
}

export async function syncReservationsForShopifyOrderUpdate(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;

  const orderReference = String(order.name ?? shopifyOrderId);
  const rawItems = order.line_items ?? [];

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    if (await hasOrderDeduction(supabase, ownerEmail, "shopify", shopifyOrderId)) {
      // Al afgeschreven — reserveringen zouden leeg moeten zijn.
      await clearReservationsForOrder(supabase, ownerEmail, "shopify", shopifyOrderId);
      continue;
    }

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("owner_email", ownerEmail)
      .eq("order_id", shopifyOrderId)
      .eq("source", "shopify")
      .maybeSingle();

    const { data: existingRes } = await supabase
      .from("inventory_reservations")
      .select("id")
      .eq("owner_email", ownerEmail)
      .eq("source", "shopify")
      .eq("external_order_id", shopifyOrderId)
      .limit(1);

    if (!existingOrder?.id && !(existingRes && existingRes.length > 0)) {
      continue;
    }

    if (rawItems.length === 0) {
      await clearReservationsForOrder(supabase, ownerEmail, "shopify", shopifyOrderId);
      continue;
    }

    const rules = await loadProductDefaultItemsRules(supabase, ownerEmail);
    const lineItems = buildInventoryDeductionLineItems(rawItems, rules);
    await syncReservationsForOrder(supabase, {
      ownerEmail,
      source: "shopify",
      externalOrderId: shopifyOrderId,
      lineItems,
      meta: {
        orderDbId: existingOrder?.id ? String(existingOrder.id) : null,
        orderNummer: orderReference,
        customerName: shopifyCustomerName(order),
        customerPhone: shopifyCustomerPhone(order),
      },
    });
  }
}

export async function releaseReservationsForShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    if (await hasOrderDeduction(supabase, ownerEmail, "shopify", shopifyOrderId)) {
      // Voorraad al afgeschreven (factuur verzonden) — niet terugboeken, reservering hoort al leeg te zijn.
      await clearReservationsForOrder(supabase, ownerEmail, "shopify", shopifyOrderId, {
        skipAlerts: true,
      });
      continue;
    }

    const n = await clearReservationsForOrder(
      supabase,
      ownerEmail,
      "shopify",
      shopifyOrderId
    );
    if (n > 0) {
      console.info(
        "[inventory-reservations] Shopify annulering — reservering vrijgegeven",
        order.name ?? shopifyOrderId,
        ownerEmail
      );
    }
  }
}

/** Commit bij fulfillment_status=fulfilled én totaal < €498. */
export async function maybeCommitInventoryOnShopifyFulfilled(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<void> {
  if (order.cancelled_at) return;
  if (String(order.fulfillment_status ?? "").toLowerCase() !== "fulfilled") return;

  const total = shopifyOrderBillableTotalIncl(order);
  if (!(total > 0 && total < AUTO_FINALIZE_INVOICE_BELOW_EUR)) return;

  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return;

  const rawItems = order.line_items ?? [];
  const orderReference = String(order.name ?? shopifyOrderId);

  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

    const rules = await loadProductDefaultItemsRules(supabase, ownerEmail);
    const lineItems = buildInventoryDeductionLineItems(rawItems, rules);
    const result = await commitReservationsForOrder(supabase, {
      ownerEmail,
      source: "shopify",
      externalOrderId: shopifyOrderId,
      orderReference,
      lineItemsFallback: lineItems,
    });
    if (result.committed) {
      console.info(
        "[inventory-reservations] Shopify fulfilled <498 — voorraad afgeschreven",
        orderReference,
        ownerEmail
      );
    }
  }
}

export async function reserveInventoryForMpOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderId: string,
  orderNummer: string,
  lineItems: LineItemForDeduction[],
  meta?: { customerName?: string | null; customerPhone?: string | null }
): Promise<void> {
  if (lineItems.length === 0) return;
  if (await hasOrderDeduction(supabase, ownerEmail, "marktplaats", orderId)) return;

  await syncReservationsForOrder(supabase, {
    ownerEmail,
    source: "marktplaats",
    externalOrderId: orderId,
    lineItems,
    meta: {
      orderDbId: orderId,
      orderNummer,
      customerName: meta?.customerName ?? null,
      customerPhone: meta?.customerPhone ?? null,
    },
  });
}

export async function commitInventoryForMpOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  orderId: string,
  orderNummer: string
): Promise<void> {
  const result = await commitReservationsForOrder(supabase, {
    ownerEmail,
    source: "marktplaats",
    externalOrderId: orderId,
    orderReference: orderNummer || orderId,
  });
  if (result.committed) {
    console.info(
      "[inventory-reservations] MP afronden — voorraad afgeschreven",
      orderNummer,
      ownerEmail
    );
  }
}

/**
 * Moneybird factuur verzonden voor Shopify-order (≥498 of zonder eerdere commit):
 * commit reserveringen i.p.v. losse factuurregels waar mogelijk.
 */
export async function commitShopifyReservationsFromMoneybirdInvoice(
  supabase: SupabaseClient,
  shopifyOrderId: string,
  invoiceId: string,
  orderReference: string
): Promise<{ committed: boolean; skippedReason?: string }> {
  const ownerEmail = moneybirdInvoiceOwnerEmail();

  if (await hasOrderDeduction(supabase, ownerEmail, "shopify", shopifyOrderId)) {
    await markOrderDeducted(supabase, ownerEmail, "moneybird", invoiceId);
    await clearReservationsForOrder(supabase, ownerEmail, "shopify", shopifyOrderId, {
      skipAlerts: true,
    });
    return { committed: false, skippedReason: "shopify_already_deducted" };
  }

  const result = await commitReservationsForOrder(supabase, {
    ownerEmail,
    source: "shopify",
    externalOrderId: shopifyOrderId,
    orderReference,
  });

  if (result.committed) {
    await markOrderDeducted(supabase, ownerEmail, "moneybird", invoiceId);
  }
  return result;
}

export async function listReservationsForInventoryProduct(
  supabase: SupabaseClient,
  ownerEmail: string,
  inventoryProductId: string
): Promise<{
  stockQuantity: number;
  reservedQuantity: number;
  sellableQuantity: number;
  reservations: InventoryReservationOrderView[];
}> {
  const { data: product } = await supabase
    .from("inventory_products")
    .select("stock_quantity")
    .eq("owner_email", ownerEmail)
    .eq("id", inventoryProductId)
    .maybeSingle();

  const stockQuantity = Number(product?.stock_quantity ?? 0);

  const { data: rows, error } = await supabase
    .from("inventory_reservations")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("inventory_product_id", inventoryProductId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const reservationsRaw = (rows ?? []) as InventoryReservationRow[];
  const reservedQuantity = reservationsRaw.reduce(
    (sum, r) => sum + Math.max(0, Math.floor(Number(r.quantity ?? 0))),
    0
  );

  const orderDbIds = Array.from(
    new Set(
      reservationsRaw
        .map((r) => r.order_db_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const orderById = new Map<
    string,
    { bezorgtijd_voorkeur: string | null; datum: string | null; naam: string | null; telefoon_e164: string | null; telefoon_nummer: string | null; order_nummer: string | null }
  >();

  if (orderDbIds.length > 0) {
    const { data: orders } = await supabase
      .from("orders")
      .select(
        "id, bezorgtijd_voorkeur, datum, naam, telefoon_e164, telefoon_nummer, order_nummer"
      )
      .eq("owner_email", ownerEmail)
      .in("id", orderDbIds);
    for (const o of orders ?? []) {
      orderById.set(String(o.id), {
        bezorgtijd_voorkeur: o.bezorgtijd_voorkeur ?? null,
        datum: o.datum ?? null,
        naam: o.naam ?? null,
        telefoon_e164: o.telefoon_e164 ?? null,
        telefoon_nummer: o.telefoon_nummer ?? null,
        order_nummer: o.order_nummer ?? null,
      });
    }
  }

  // Shopify zonder order_db_id: probeer via order_id = external_order_id
  const shopifyExternals = reservationsRaw
    .filter((r) => r.source === "shopify" && !r.order_db_id)
    .map((r) => r.external_order_id);
  const shopifyOrderByExternal = new Map<string, (typeof orderById extends Map<string, infer V> ? V : never)>();
  if (shopifyExternals.length > 0) {
    const { data: orders } = await supabase
      .from("orders")
      .select(
        "id, order_id, bezorgtijd_voorkeur, datum, naam, telefoon_e164, telefoon_nummer, order_nummer"
      )
      .eq("owner_email", ownerEmail)
      .eq("source", "shopify")
      .in("order_id", shopifyExternals);
    for (const o of orders ?? []) {
      shopifyOrderByExternal.set(String(o.order_id), {
        bezorgtijd_voorkeur: o.bezorgtijd_voorkeur ?? null,
        datum: o.datum ?? null,
        naam: o.naam ?? null,
        telefoon_e164: o.telefoon_e164 ?? null,
        telefoon_nummer: o.telefoon_nummer ?? null,
        order_nummer: o.order_nummer ?? null,
      });
    }
  }

  const reservations: InventoryReservationOrderView[] = reservationsRaw.map((r) => {
    const live =
      (r.order_db_id ? orderById.get(r.order_db_id) : null) ??
      (r.source === "shopify" ? shopifyOrderByExternal.get(r.external_order_id) : null);
    const voorkeursdatum =
      String(live?.bezorgtijd_voorkeur ?? "").trim() ||
      String(live?.datum ?? "").trim() ||
      null;
    const phone =
      String(live?.telefoon_e164 ?? live?.telefoon_nummer ?? r.customer_phone ?? "").trim() ||
      null;
    return {
      reservationId: r.id,
      quantity: Math.max(0, Math.floor(Number(r.quantity ?? 0))),
      source: r.source,
      externalOrderId: r.external_order_id,
      orderDbId: r.order_db_id,
      orderNummer: live?.order_nummer || r.order_nummer,
      customerName: live?.naam || r.customer_name,
      customerPhone: phone,
      voorkeursdatum,
    };
  });

  return {
    stockQuantity,
    reservedQuantity,
    sellableQuantity: sellableFrom(stockQuantity, reservedQuantity),
    reservations,
  };
}
