/**
 * Moneybird API-client (sales invoices + webhook signature).
 * @see https://developer.moneybird.com/
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ShopifyLineItem,
  ShopifyLineSnapshot,
  ShopifyOrder,
  ShopifyShippingLine,
} from "@/lib/shopify-order";
import {
  buildShopifyLineSnapshot,
  diffShopifyLineSnapshots,
  effectiveShopifyLineQuantity,
  shopifyOrderPaymentAmounts,
} from "@/lib/shopify-order";
import {
  fetchShopifyOrderMolliePayment,
  isShopifyProductActive,
  markShopifyOrderAsPaid,
  type ShopifyAdminProduct,
} from "@/lib/shopify-admin";

const MONEYBIRD_API_BASE = "https://moneybird.com/api/v2";

/**
 * Drempel (incl. BTW): onder dit bedrag auto-mailen zodra Shopify fulfillment_status = fulfilled.
 * ≥ deze drempel blijft concept (handmatig versturen, o.a. serienummer).
 */
export const AUTO_FINALIZE_INVOICE_BELOW_EUR = 490;

export function isMoneybirdConfigured(): boolean {
  return Boolean(
    process.env.MONEYBIRD_ADMINISTRATION_ID?.trim() &&
      process.env.MONEYBIRD_API_TOKEN?.trim() &&
      process.env.MONEYBIRD_TAX_RATE_ID?.trim() &&
      process.env.MONEYBIRD_LEDGER_ACCOUNT_ID?.trim()
  );
}

function adminId(): string {
  const id = process.env.MONEYBIRD_ADMINISTRATION_ID?.trim();
  if (!id) throw new Error("MONEYBIRD_ADMINISTRATION_ID ontbreekt.");
  return id;
}

function apiToken(): string {
  const token = process.env.MONEYBIRD_API_TOKEN?.trim();
  if (!token) throw new Error("MONEYBIRD_API_TOKEN ontbreekt.");
  return token;
}

async function moneybirdFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${MONEYBIRD_API_BASE}/${adminId()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const detail =
      typeof body === "object" && body != null
        ? JSON.stringify(body)
        : String(body ?? res.statusText);
    throw new Error(`Moneybird ${res.status}: ${detail}`);
  }
  // DELETE e.d. kunnen 204 zonder body teruggeven.
  if (body == null && (res.status === 204 || res.status === 200)) {
    return undefined as T;
  }
  return body as T;
}

export type MoneybirdContact = {
  id: string;
  email?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  company_name?: string | null;
};

export type MoneybirdSalesInvoiceDetail = {
  id?: string;
  description?: string | null;
  amount?: string | null;
  price?: string | null;
  product_id?: string | null;
};

export type MoneybirdPayment = {
  id?: string;
  transaction_identifier?: string | null;
  price?: string | number | null;
  payment_date?: string | null;
};

export type MoneybirdSalesInvoice = {
  id: string;
  invoice_id?: string | null;
  reference?: string | null;
  state?: string | null;
  contact_id?: string | null;
  details?: MoneybirdSalesInvoiceDetail[] | null;
  payments?: MoneybirdPayment[] | null;
  total_paid?: string | number | null;
  total_unpaid?: string | number | null;
  price_total?: string | number | null;
};

/** Machine-leesbare Shopify-koppeling op factuur.reference. */
export function shopifyReferenceForOrderId(shopifyOrderId: string): string {
  return `shopify:${shopifyOrderId}`;
}

/** Reference voor bijfactuur na betaalde/verstuurde hoofdfactuur (toegevoegde regels). */
export function shopifyAdditionReference(
  shopifyOrderId: string,
  snapshots: ShopifyLineSnapshot[]
): string {
  const ids = [...snapshots.map((s) => s.id)].sort().join(",");
  return `shopify:${shopifyOrderId}:add:${ids}`;
}

/** Reference voor deelcredit na verwijderde/verlaagde regels. */
export function shopifyCreditReference(
  shopifyOrderId: string,
  snapshots: ShopifyLineSnapshot[]
): string {
  const ids = [...snapshots.map((s) => s.id)].sort().join(",");
  return `shopify:${shopifyOrderId}:credit:${ids}`;
}

/** Reference voor volledige credit bij refund/cancel. */
export function shopifyFullCreditReference(shopifyOrderId: string): string {
  return `shopify:${shopifyOrderId}:credit:full`;
}

export function parseShopifyOrderIdFromReference(
  reference: string | null | undefined
): string | null {
  const raw = String(reference ?? "").trim();
  const m = raw.match(/^shopify:(\d+)\b/i);
  return m?.[1] ?? null;
}

/** Alleen hoofdfactuur `shopify:{id}` — geen add-/credit-referenties. */
export function parseMainShopifyOrderIdFromInvoiceReference(
  reference: string | null | undefined
): string | null {
  const raw = String(reference ?? "").trim();
  const m = raw.match(/^shopify:(\d+)$/i);
  return m?.[1] ?? null;
}

/** Volledige factuur ophalen (incl. details) — o.a. als webhook-entity incomplete is. */
export async function fetchSalesInvoiceById(
  invoiceId: string
): Promise<MoneybirdSalesInvoice | null> {
  const id = String(invoiceId ?? "").trim();
  if (!id) return null;
  try {
    return await moneybirdFetch<MoneybirdSalesInvoice>(`/sales_invoices/${id}.json`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Moneybird 404")) return null;
    throw err;
  }
}

async function findSalesInvoiceByReference(
  reference: string
): Promise<MoneybirdSalesInvoice | null> {
  const enc = encodeURIComponent(reference);
  try {
    return await moneybirdFetch<MoneybirdSalesInvoice>(
      `/sales_invoices/find_by_reference/${enc}.json`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("Moneybird 404")) throw err;
  }

  // Fallback: lijstfilter (vindt ook als find_by_reference traag is na create).
  try {
    const filter = encodeURIComponent(`reference:${reference},period:this_year`);
    const list = await moneybirdFetch<MoneybirdSalesInvoice[]>(
      `/sales_invoices.json?filter=${filter}&per_page=10`
    );
    if (!Array.isArray(list) || list.length === 0) return null;
    const exact = list.find((inv) => String(inv.reference ?? "") === reference);
    return exact ?? list[0] ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Moneybird 404")) return null;
    throw err;
  }
}

async function findSalesInvoiceByReferenceWithRetry(
  reference: string,
  attempts = 3,
  delayMs = 250
): Promise<MoneybirdSalesInvoice | null> {
  for (let i = 0; i < attempts; i++) {
    const found = await findSalesInvoiceByReference(reference);
    if (found) return found;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

async function acquireMoneybirdShopifyInvoiceLock(
  supabase: SupabaseClient,
  shopifyOrderId: string
): Promise<"acquired" | "existing" | "unavailable"> {
  const { error } = await supabase
    .from("moneybird_shopify_invoice_locks")
    .insert({ shopify_order_id: shopifyOrderId });

  if (!error) return "acquired";
  if (error.code === "23505") return "existing";
  // Tabel ontbreekt / RLS / netwerk: niet behandelen als "bestaat al" (dat skipte create).
  console.error("[moneybird] invoice lock insert error:", error.message);
  return "unavailable";
}

async function releaseMoneybirdShopifyInvoiceLock(
  supabase: SupabaseClient,
  shopifyOrderId: string
): Promise<void> {
  await supabase
    .from("moneybird_shopify_invoice_locks")
    .delete()
    .eq("shopify_order_id", shopifyOrderId);
}

async function storeMoneybirdShopifyInvoiceId(
  supabase: SupabaseClient,
  shopifyOrderId: string,
  moneybirdInvoiceId: string
): Promise<void> {
  await supabase
    .from("moneybird_shopify_invoice_locks")
    .update({ moneybird_invoice_id: moneybirdInvoiceId })
    .eq("shopify_order_id", shopifyOrderId);
}

/**
 * Verifieert Moneybird-Signature header (HMAC-SHA256 over `{t}.{rawBody}`).
 * Als geen secret is geconfigureerd: skip (dev), return true.
 */
export function verifyMoneybirdWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined
): boolean {
  const secret = process.env.MONEYBIRD_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn("[moneybird] MONEYBIRD_WEBHOOK_SECRET ontbreekt — signature check overgeslagen.");
    return true;
  }
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",").map((p) => p.trim());
  let timestamp: string | null = null;
  const v1Digests: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Digests.push(value);
  }
  if (!timestamp || v1Digests.length === 0) return false;

  const tsNum = parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (ageSec > 5 * 60) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  for (const digest of v1Digests) {
    const got = Buffer.from(digest, "utf8");
    if (got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf)) {
      return true;
    }
  }
  return false;
}

async function findContactByEmail(email: string): Promise<MoneybirdContact | null> {
  const q = encodeURIComponent(email.trim());
  const list = await moneybirdFetch<MoneybirdContact[]>(`/contacts.json?query=${q}&per_page=10`);
  if (!Array.isArray(list) || list.length === 0) return null;
  const needle = email.trim().toLowerCase();
  const exact = list.find((c) => String(c.email ?? "").trim().toLowerCase() === needle);
  return exact ?? list[0] ?? null;
}

async function createContact(input: {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  address1?: string;
  zipcode?: string;
  city?: string;
  country?: string;
}): Promise<MoneybirdContact> {
  const payload = {
    contact: {
      email: input.email,
      firstname: input.firstname ?? "",
      lastname: input.lastname ?? "",
      phone: input.phone ?? "",
      address1: input.address1 ?? "",
      zipcode: input.zipcode ?? "",
      city: input.city ?? "",
      country: input.country ?? "NL",
      send_invoices_to_email: input.email,
    },
  };
  return moneybirdFetch<MoneybirdContact>("/contacts.json", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function findOrCreateContactForShopifyOrder(
  order: ShopifyOrder
): Promise<MoneybirdContact> {
  const email =
    String(order.email ?? order.contact_email ?? order.customer?.email ?? "")
      .trim()
      .toLowerCase() || "onbekend@koopjefatbike.nl";

  const existing = await findContactByEmail(email);
  if (existing) return existing;

  const shipping = order.shipping_address ?? order.billing_address;
  return createContact({
    email,
    firstname: String(order.customer?.first_name ?? "").trim(),
    lastname: String(order.customer?.last_name ?? "").trim() || "Klant",
    phone: String(order.phone ?? order.customer?.phone ?? shipping?.phone ?? "").trim(),
    address1: String(shipping?.address1 ?? "").trim(),
    zipcode: String(shipping?.zip ?? "").trim(),
    city: String(shipping?.city ?? "").trim(),
    country: "NL",
  });
}

function unitPriceExclApprox(
  price: string | number | null | undefined,
  vatMultiplier = 1.21
): string {
  const n =
    typeof price === "string" ? parseFloat(price) : Number(price ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0.00";
  // Shopify-prijzen zijn typisch incl. BTW; Moneybird-regelprijs is excl.
  const mul = vatMultiplier > 1 ? vatMultiplier : 1.21;
  const excl = n / mul;
  return excl.toFixed(2);
}

function parseMoneyAmount(value: string | number | null | undefined): number {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

function lineItemNetTotalIncl(li: ShopifyLineItem): number {
  const price = parseMoneyAmount(li.price);
  const qty = effectiveShopifyLineQuantity(li);
  if (qty <= 0 || !Number.isFinite(price)) return 0;
  let total = price * qty;
  const discount = parseMoneyAmount(li.total_discount);
  if (Number.isFinite(discount)) total -= discount;
  for (const allocation of li.discount_allocations ?? []) {
    const amt = parseMoneyAmount(allocation.amount);
    if (Number.isFinite(amt)) total -= amt;
  }
  return Math.max(0, total);
}

function lineItemUnitPriceIncl(li: ShopifyLineItem): number {
  const qty = effectiveShopifyLineQuantity(li);
  if (qty <= 0) return 0;
  return lineItemNetTotalIncl(li) / qty;
}

function shippingLineNetTotalIncl(line: ShopifyShippingLine): number {
  const discounted = parseMoneyAmount(line.discounted_price);
  if (Number.isFinite(discounted)) return Math.max(0, discounted);
  const price = parseMoneyAmount(line.price);
  return Number.isFinite(price) ? Math.max(0, price) : 0;
}

function moneybirdNinePercentTaxRateId(): string {
  return (
    process.env.MONEYBIRD_TAX_RATE_ID_9?.trim() ||
    process.env.MONEYBIRD_TAX_RATE_ID_LOW?.trim() ||
    ""
  );
}

/** Incl.-factor voor een Moneybird tax_rate_id (9% of standaard 21%). */
function vatMultiplierForTaxRateId(taxRateId: string): number {
  const nine = moneybirdNinePercentTaxRateId();
  if (nine && taxRateId === nine) return 1.09;
  return 1.21;
}

/**
 * Zelfde BTW-keuze als product-sync: gereduceerd (rijklaar e.d.) → 9%, anders 21%.
 * Factuurregels kunnen per regel een ander tarief hebben.
 */
function resolveInvoiceTaxForTitle(title: string): {
  taxRateId: string;
  vatMultiplier: number;
} {
  const defaultId = process.env.MONEYBIRD_TAX_RATE_ID!.trim();
  const taxRateId = moneybirdTaxRateIdForProductTitle(title) || defaultId;
  return {
    taxRateId,
    vatMultiplier: vatMultiplierForTaxRateId(taxRateId),
  };
}

function invoiceDetailLineTotalIncl(detail: MoneybirdInvoiceDetailPayload): number {
  const excl = (parseFloat(detail.price) || 0) * (parseFloat(detail.amount) || 0);
  return excl * vatMultiplierForTaxRateId(detail.tax_rate_id);
}

/** Ordertotaal incl. BTW — current_total_price (na edit), anders total_price, anders som. */
export function shopifyOrderBillableTotalIncl(order: ShopifyOrder): number {
  const fromCurrent = parseMoneyAmount(order.current_total_price);
  const fromTotal = parseMoneyAmount(order.total_price);
  const lineSum = (order.line_items ?? []).reduce(
    (sum, li) => sum + lineItemNetTotalIncl(li),
    0
  );
  const shippingSum = (order.shipping_lines ?? []).reduce(
    (sum, sl) => sum + shippingLineNetTotalIncl(sl),
    0
  );

  if (Number.isFinite(fromCurrent)) return Math.max(0, fromCurrent);
  if (Number.isFinite(fromTotal)) return Math.max(0, fromTotal);
  return lineSum + shippingSum;
}

function isZeroInvoiceTotal(totalIncl: number): boolean {
  return !Number.isFinite(totalIncl) || totalIncl < 0.01;
}

type MoneybirdInvoiceDetailPayload = {
  description: string;
  price: string;
  amount: string;
  tax_rate_id: string;
  ledger_account_id: string;
  product_id?: string;
};

/**
 * Factuurregels voor een subset van Shopify-regels (snapshot qty).
 * Geen verzending / geen ordertotaal-reconciliatie — voor add/credit deel-facturen.
 */
export async function buildInvoiceDetailsFromLineSnapshots(
  order: ShopifyOrder,
  snapshots: ShopifyLineSnapshot[]
): Promise<MoneybirdInvoiceDetailPayload[] | null> {
  return buildInvoiceDetailsInternal(order, {
    mode: "snapshots",
    snapshots,
  });
}

async function buildInvoiceDetailsFromShopifyOrder(
  order: ShopifyOrder
): Promise<MoneybirdInvoiceDetailPayload[] | null> {
  return buildInvoiceDetailsInternal(order, { mode: "full" });
}

async function buildInvoiceDetailsInternal(
  order: ShopifyOrder,
  opts: { mode: "full" } | { mode: "snapshots"; snapshots: ShopifyLineSnapshot[] }
): Promise<MoneybirdInvoiceDetailPayload[] | null> {
  const shopifyOrderId = String(order.id ?? "").trim();
  const taxRateId21 = process.env.MONEYBIRD_TAX_RATE_ID!.trim();
  const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();
  const orderName = String(order.name ?? shopifyOrderId).trim();

  const details: MoneybirdInvoiceDetailPayload[] = [];
  const mbProductIdByShopifyProduct = new Map<string, string | null>();

  async function moneybirdProductIdForShopifyProduct(
    shopifyProductId: string | number | null | undefined
  ): Promise<string | undefined> {
    const key = String(shopifyProductId ?? "").trim();
    if (!key || key === "0") return undefined;
    if (mbProductIdByShopifyProduct.has(key)) {
      return mbProductIdByShopifyProduct.get(key) || undefined;
    }
    try {
      const mb = await findProductByIdentifier(shopifyProductIdentifier(key));
      const id = mb?.id ? String(mb.id) : null;
      mbProductIdByShopifyProduct.set(key, id);
      return id || undefined;
    } catch {
      mbProductIdByShopifyProduct.set(key, null);
      return undefined;
    }
  }

  async function pushLineItemDetail(
    li: ShopifyLineItem,
    qtyOverride?: number
  ): Promise<void> {
    const description = String(li.name ?? "").trim();
    if (!description) return;
    const qty =
      qtyOverride != null
        ? Math.max(0, Math.round(qtyOverride))
        : effectiveShopifyLineQuantity(li);
    if (qty <= 0) return;
    const synthetic: ShopifyLineItem =
      qtyOverride != null
        ? { ...li, quantity: qty, current_quantity: qty }
        : li;
    const unitIncl = lineItemUnitPriceIncl(synthetic);
    if (unitIncl < 0.01) return;
    const amount = Math.max(1, qty);
    const productId = await moneybirdProductIdForShopifyProduct(li.product_id);
    const { taxRateId, vatMultiplier } = resolveInvoiceTaxForTitle(description);
    if (
      isMoneybirdReducedVatProductTitle(description) &&
      !moneybirdNinePercentTaxRateId()
    ) {
      console.warn(
        "[moneybird] factuurregel 9%-product zonder MONEYBIRD_TAX_RATE_ID_9 — valt terug op 21%:",
        description
      );
    }
    details.push({
      description: `${description} (${orderName})`,
      price: unitPriceExclApprox(unitIncl, vatMultiplier),
      amount: String(amount),
      tax_rate_id: taxRateId,
      ledger_account_id: ledgerAccountId,
      ...(productId ? { product_id: productId } : {}),
    });
  }

  // Prefetch Moneybird product-ids parallel (niet N× sequentieel).
  const productIdsToPrefetch = new Set<string>();
  if (opts.mode === "snapshots") {
    const byIdPrefetch = new Map(
      (order.line_items ?? []).map((li) => [String(li.id ?? "").trim(), li])
    );
    for (const snap of opts.snapshots) {
      const li = byIdPrefetch.get(snap.id);
      const pid = String(li?.product_id ?? "").trim();
      if (pid && pid !== "0") productIdsToPrefetch.add(pid);
    }
  } else {
    for (const li of order.line_items ?? []) {
      const pid = String(li.product_id ?? "").trim();
      if (pid && pid !== "0") productIdsToPrefetch.add(pid);
    }
  }
  await Promise.all(
    Array.from(productIdsToPrefetch).map((pid) =>
      moneybirdProductIdForShopifyProduct(pid)
    )
  );

  if (opts.mode === "snapshots") {
    const byId = new Map(
      (order.line_items ?? []).map((li) => [String(li.id ?? "").trim(), li])
    );
    for (const snap of opts.snapshots) {
      if (snap.qty <= 0) continue;
      const li = byId.get(snap.id);
      if (li) {
        await pushLineItemDetail(li, snap.qty);
        continue;
      }
      // Fallback: snapshot zonder matchende line item (zeldzaam).
      const description = String(snap.name ?? "").trim();
      if (!description || snap.unitPrice < 0.01) continue;
      const { taxRateId, vatMultiplier } = resolveInvoiceTaxForTitle(description);
      details.push({
        description: `${description} (${orderName})`,
        price: unitPriceExclApprox(snap.unitPrice, vatMultiplier),
        amount: String(Math.max(1, Math.round(snap.qty))),
        tax_rate_id: taxRateId,
        ledger_account_id: ledgerAccountId,
      });
    }
    return details.length > 0 ? details : null;
  }

  for (const li of order.line_items ?? []) {
    await pushLineItemDetail(li);
  }

  for (const sl of order.shipping_lines ?? []) {
    const shippingIncl = shippingLineNetTotalIncl(sl);
    if (shippingIncl < 0.01) continue;
    const title = String(sl.title ?? "Verzendkosten").trim() || "Verzendkosten";
    details.push({
      description: `${title} (${orderName})`,
      price: unitPriceExclApprox(shippingIncl, 1.21),
      amount: "1",
      tax_rate_id: taxRateId21,
      ledger_account_id: ledgerAccountId,
    });
  }

  if (details.length === 0) return null;

  const targetIncl = shopifyOrderBillableTotalIncl(order);
  if (targetIncl >= 0.01) {
    const builtIncl = details.reduce((sum, d) => sum + invoiceDetailLineTotalIncl(d), 0);
    const diffIncl = Math.round((builtIncl - targetIncl) * 100) / 100;
    // Restbedrag op standaard 21% (geen productregel).
    if (diffIncl > 0.01) {
      details.push({
        description: `Korting (${orderName})`,
        price: (-diffIncl / 1.21).toFixed(2),
        amount: "1",
        tax_rate_id: taxRateId21,
        ledger_account_id: ledgerAccountId,
      });
    } else if (diffIncl < -0.01) {
      details.push({
        description: `Aanpassing (${orderName})`,
        price: (-diffIncl / 1.21).toFixed(2),
        amount: "1",
        tax_rate_id: taxRateId21,
        ledger_account_id: ledgerAccountId,
      });
    }
  }

  const detailsTotalExcl = details.reduce(
    (sum, d) => sum + (parseFloat(d.price) || 0) * (parseFloat(d.amount) || 0),
    0
  );
  if (detailsTotalExcl < 0.01 && targetIncl < 0.01) return null;

  return details;
}

export function isDraftMoneybirdInvoice(invoice: MoneybirdSalesInvoice): boolean {
  return String(invoice.state ?? "").toLowerCase() === "draft";
}

/** Shopify-order e-mail voor factuurverzending (leeg = Moneybird contact-default). */
function shopifyOrderInvoiceEmail(order: ShopifyOrder): string | null {
  const raw = String(
    order.email ?? order.contact_email ?? order.customer?.email ?? ""
  )
    .trim()
    .toLowerCase();
  if (!raw || !raw.includes("@") || raw === "onbekend@koopjefatbike.nl") {
    return null;
  }
  return raw;
}

/**
 * Mag de conceptfactuur automatisch gemaild worden?
 * - niet geannuleerd
 * - fulfillment_status === fulfilled
 * - totaal &gt; 0 en &lt; AUTO_FINALIZE_INVOICE_BELOW_EUR
 */
export function shouldAutoSendShopifyInvoice(order: ShopifyOrder): boolean {
  if (order.cancelled_at) return false;
  const fulfillment = String(order.fulfillment_status ?? "").toLowerCase();
  if (fulfillment !== "fulfilled") return false;
  const totalIncl = shopifyOrderBillableTotalIncl(order);
  if (isZeroInvoiceTotal(totalIncl)) return false;
  return totalIncl < AUTO_FINALIZE_INVOICE_BELOW_EUR;
}

/**
 * Verstuur een Moneybird-factuur per e-mail (draft → open).
 * @see https://developer.moneybird.com/api/sales_invoices/#patch_sales_invoices_id_send_invoice
 */
export async function sendSalesInvoiceByEmail(
  invoiceId: string,
  options?: { emailAddress?: string | null }
): Promise<MoneybirdSalesInvoice> {
  const id = String(invoiceId ?? "").trim();
  if (!id) throw new Error("invoiceId ontbreekt.");

  const salesInvoiceSending: Record<string, string> = {
    delivery_method: "Email",
  };
  const email = String(options?.emailAddress ?? "").trim();
  if (email.includes("@")) {
    salesInvoiceSending.email_address = email;
  }

  return moneybirdFetch<MoneybirdSalesInvoice>(
    `/sales_invoices/${id}/send_invoice.json`,
    {
      method: "PATCH",
      body: JSON.stringify({ sales_invoice_sending: salesInvoiceSending }),
    }
  );
}

/**
 * Na create/update: onder €490 + fulfilled → conceptfactuur e-mailen (idempotent).
 */
export async function maybeSendSalesInvoiceAfterShopifyFulfillment(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<{
  sent: boolean;
  skipped?: string;
  invoiceId?: string;
}> {
  if (!isMoneybirdConfigured()) {
    return { sent: false, skipped: "not_configured" };
  }
  if (!shouldAutoSendShopifyInvoice(order)) {
    return { sent: false, skipped: "not_eligible" };
  }

  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) {
    return { sent: false, skipped: "missing_order_id" };
  }

  const reference = shopifyReferenceForOrderId(shopifyOrderId);
  let invoice = await findSalesInvoiceByReference(reference);

  // Edge case: create miste eerder, order is nu al fulfilled.
  if (!invoice?.id) {
    console.info(
      "[moneybird] fulfilled <490 zonder factuur — create alsnog",
      reference
    );
    invoice = await createSalesInvoiceFromShopifyOrder(supabase, order);
  }
  if (!invoice?.id) {
    return { sent: false, skipped: "no_invoice" };
  }

  const full = (await fetchSalesInvoiceById(invoice.id)) ?? invoice;
  if (!isDraftMoneybirdInvoice(full)) {
    console.info(
      "[moneybird] auto-send skip — factuur niet meer concept",
      full.id,
      full.state ?? "?"
    );
    return {
      sent: false,
      skipped: `state_${String(full.state ?? "unknown").toLowerCase()}`,
      invoiceId: full.id,
    };
  }

  try {
    const sent = await sendSalesInvoiceByEmail(full.id, {
      emailAddress: shopifyOrderInvoiceEmail(order),
    });
    console.info(
      "[moneybird] factuur auto-verzonden (fulfilled <€490)",
      sent.id ?? full.id,
      reference,
      `€${shopifyOrderBillableTotalIncl(order).toFixed(2)}`
    );
    return { sent: true, invoiceId: sent.id ?? full.id };
  } catch (err) {
    console.error(
      "[moneybird] auto-send mislukt",
      full.id,
      reference,
      err instanceof Error ? err.message : err
    );
    return { sent: false, skipped: "send_failed", invoiceId: full.id };
  }
}

/** Vergelijkbare factuurregels (om irrelevante Shopify-pings te skippen). */
function invoiceDetailsFingerprint(
  details: Array<{
    description?: string | null;
    amount?: string | null;
    price?: string | null;
  }>
): string {
  const rows = details
    .map((d) => ({
      description: String(d.description ?? "").trim(),
      amount: String(Math.max(0, Math.floor(parseFloat(String(d.amount ?? "0")) || 0))),
      price: (parseFloat(String(d.price ?? "0")) || 0).toFixed(2),
    }))
    .filter((d) => d.description.length > 0)
    .sort((a, b) =>
      a.description.localeCompare(b.description) ||
      a.amount.localeCompare(b.amount) ||
      a.price.localeCompare(b.price)
    );
  return JSON.stringify(rows);
}

function invoiceDetailsUnchanged(
  existing: MoneybirdSalesInvoiceDetail[] | null | undefined,
  desired: MoneybirdInvoiceDetailPayload[]
): boolean {
  return (
    invoiceDetailsFingerprint(existing ?? []) ===
    invoiceDetailsFingerprint(desired)
  );
}

/** Schaal factuurregel-prijzen (excl.) zodat som incl. ≈ targetIncl. */
function scaleInvoiceDetailsToTargetIncl(
  details: MoneybirdInvoiceDetailPayload[],
  targetIncl: number
): MoneybirdInvoiceDetailPayload[] {
  if (!(targetIncl >= 0.01) || details.length === 0) return details;
  const current = details.reduce((sum, d) => sum + invoiceDetailLineTotalIncl(d), 0);
  if (!(current >= 0.01) || Math.abs(current - targetIncl) < 0.01) return details;
  const factor = targetIncl / current;
  return details.map((d) => ({
    ...d,
    price: ((parseFloat(d.price) || 0) * factor).toFixed(2),
  }));
}

function correctionKenmerkForMainInvoice(main: MoneybirdSalesInvoice): string {
  const num =
    String(main.invoice_id ?? "").trim() ||
    String(main.id ?? "").trim() ||
    "onbekend";
  return `correctie factuur ${num}`;
}

function shopifyCorrectionReference(shopifyOrderId: string): string {
  return `shopify:${shopifyOrderId}:correctie`;
}

/**
 * orders/updated: alleen bestaande conceptfactuur bijwerken — nooit een nieuwe aanmaken.
 * Alleen PATCH als regels/contact echt wijzigen t.o.v. de huidige conceptfactuur.
 * @param lockTotalIncl als gezet: nieuwe producten, maar prijzen geschaald naar dit totaal (betaalde concept).
 */
export async function updateDraftSalesInvoiceFromShopifyOrder(
  order: ShopifyOrder,
  opts?: { lockTotalIncl?: number | null }
): Promise<MoneybirdSalesInvoice | null> {
  if (!isMoneybirdConfigured()) {
    console.warn("[moneybird] niet geconfigureerd — factuur-update overgeslagen.");
    return null;
  }

  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return null;

  const lockTotal =
    opts?.lockTotalIncl != null && Number.isFinite(Number(opts.lockTotalIncl))
      ? Number(opts.lockTotalIncl)
      : null;

  if (
    lockTotal == null &&
    isZeroInvoiceTotal(shopifyOrderBillableTotalIncl(order))
  ) {
    console.info(
      "[moneybird] order update totaal €0 — geen factuurwijziging",
      shopifyOrderId,
      order.name ?? ""
    );
    return null;
  }

  const reference = shopifyReferenceForOrderId(shopifyOrderId);
  const existing = await findSalesInvoiceByReference(reference);
  if (!existing?.id) {
    console.info(
      "[moneybird] order update — geen bestaande factuur, geen nieuwe create",
      reference
    );
    return null;
  }

  const full = await moneybirdFetch<MoneybirdSalesInvoice>(
    `/sales_invoices/${existing.id}.json`
  );

  if (!isDraftMoneybirdInvoice(full)) {
    console.info(
      "[moneybird] order update — factuur niet meer concept, skip",
      full.id,
      full.state ?? "?"
    );
    return full;
  }

  let details = await buildInvoiceDetailsFromShopifyOrder(order);
  if (!details) {
    console.warn("[moneybird] order update — geen factuurregels", shopifyOrderId);
    return null;
  }
  if (lockTotal != null && lockTotal >= 0.01) {
    details = scaleInvoiceDetailsToTargetIncl(details, lockTotal);
  }

  const contact = await findOrCreateContactForShopifyOrder(order);
  const contactUnchanged =
    String(full.contact_id ?? "") === String(contact.id ?? "");
  if (contactUnchanged && invoiceDetailsUnchanged(full.details, details)) {
    console.info(
      "[moneybird] order update — conceptfactuur al in sync, skip",
      full.id,
      order.name ?? shopifyOrderId
    );
    return full;
  }

  const destroyOld = (full.details ?? [])
    .filter((d) => d.id)
    .map((d) => ({ id: d.id, _destroy: "1" }));

  const updated = await moneybirdFetch<MoneybirdSalesInvoice>(
    `/sales_invoices/${full.id}.json`,
    {
      method: "PATCH",
      body: JSON.stringify({
        sales_invoice: {
          contact_id: contact.id,
          details_attributes: [...destroyOld, ...details],
        },
      }),
    }
  );

  console.info(
    "[moneybird] conceptfactuur bijgewerkt",
    updated.id,
    "voor Shopify",
    order.name ?? shopifyOrderId
  );
  return updated;
}

/**
 * Registreer Mollie-betaling op Moneybird-factuur met transaction_identifier (tr_…).
 * Nodig zodat de officiële Moneybird↔Mollie-koppeling uitbetalingen kan afletteren.
 * Alleen als Shopify-order via Mollie is betaald; idempotent op dezelfde tr_.
 */
export async function registerMolliePaymentOnShopifyInvoice(
  shopifyOrderId: string,
  invoiceId?: string | null
): Promise<{
  registered: boolean;
  skipped?: string;
  molliePaymentId?: string;
  paymentId?: string;
  error?: string;
}> {
  if (!isMoneybirdConfigured()) {
    return { registered: false, skipped: "moneybird_not_configured" };
  }
  const orderId = String(shopifyOrderId ?? "").trim();
  if (!orderId) return { registered: false, skipped: "missing_shopify_order_id" };

  const mollie = await fetchShopifyOrderMolliePayment(orderId);
  if (!mollie?.molliePaymentId) {
    return { registered: false, skipped: "no_mollie_payment" };
  }

  let invoice: MoneybirdSalesInvoice | null = null;
  const invId = String(invoiceId ?? "").trim();
  if (invId) invoice = await fetchSalesInvoiceById(invId);
  if (!invoice?.id) {
    invoice = await findSalesInvoiceByReference(shopifyReferenceForOrderId(orderId));
  }
  if (!invoice?.id) {
    return {
      registered: false,
      skipped: "no_invoice",
      molliePaymentId: mollie.molliePaymentId,
    };
  }

  const full = (await fetchSalesInvoiceById(invoice.id)) ?? invoice;
  const existingPayments = Array.isArray(full.payments) ? full.payments : [];
  const already = existingPayments.some(
    (p) =>
      String(p.transaction_identifier ?? "").trim() === mollie.molliePaymentId
  );
  if (already) {
    return {
      registered: false,
      skipped: "already_registered",
      molliePaymentId: mollie.molliePaymentId,
      paymentId: full.id,
    };
  }

  const invoiceTotal = parseMoneyAmount(full.price_total);
  const price =
    mollie.amount > 0.009
      ? mollie.amount
      : Number.isFinite(invoiceTotal) && invoiceTotal > 0
        ? invoiceTotal
        : 0;
  if (!(price > 0.009)) {
    return {
      registered: false,
      skipped: "zero_amount",
      molliePaymentId: mollie.molliePaymentId,
    };
  }
  const paymentDateRaw = mollie.processedAt
    ? new Date(mollie.processedAt)
    : new Date();
  const paymentDate = Number.isNaN(paymentDateRaw.getTime())
    ? new Date().toISOString().slice(0, 10)
    : paymentDateRaw.toISOString().slice(0, 10);

  try {
    const created = await moneybirdFetch<MoneybirdPayment>(
      `/sales_invoices/${full.id}/payments.json`,
      {
        method: "POST",
        body: JSON.stringify({
          payment: {
            payment_date: paymentDate,
            price: price.toFixed(2),
            transaction_identifier: mollie.molliePaymentId,
            manual_payment_action: "payment_without_proof",
          },
        }),
      }
    );
    console.info(
      "[moneybird] Mollie-betaling geregistreerd",
      full.id,
      mollie.molliePaymentId,
      `€${price.toFixed(2)}`
    );
    return {
      registered: true,
      molliePaymentId: mollie.molliePaymentId,
      paymentId: created?.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Draft-facturen accepteren soms geen betaling — later opnieuw bij versturen.
    console.error(
      "[moneybird] Mollie-betaling registreren mislukt",
      full.id,
      mollie.molliePaymentId,
      msg
    );
    return {
      registered: false,
      molliePaymentId: mollie.molliePaymentId,
      error: msg,
    };
  }
}

/**
 * Routeert Moneybird-factuuractie op Shopify-webhook topic.
 * - orders/create → nieuwe conceptfactuur (indien van toepassing)
 * - orders/updated | orders/edited → draft bijwerken; bij betaald+zelfde totaal ook draft;
 *   anders add/credit bij betaald/verstuurd
 * - daarna: auto-mail als fulfilled én totaal < €490 (alleen hoofdfactuur)
 * - daarna: Mollie tr_ op factuurbetaling (voor uitbetalingskoppeling)
 */
export async function syncSalesInvoiceFromShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder,
  topic: string,
  opts?: {
    previousSnapshot?: ShopifyLineSnapshot[] | null;
    /** Ordertotaal vóór deze update (bestelling_totaal_prijs uit DB). */
    previousTotal?: number | null;
  }
): Promise<MoneybirdSalesInvoice | null> {
  const normalizedTopic = topic.trim().toLowerCase();
  let invoice: MoneybirdSalesInvoice | null = null;

  if (
    normalizedTopic === "orders/updated" ||
    normalizedTopic === "orders/edited"
  ) {
    invoice = await syncSalesInvoiceOnShopifyOrderUpdate(supabase, order, opts);
  } else if (normalizedTopic === "orders/create") {
    invoice = await createSalesInvoiceFromShopifyOrder(supabase, order);
  } else {
    return null;
  }

  try {
    const sendResult = await maybeSendSalesInvoiceAfterShopifyFulfillment(
      supabase,
      order
    );
    if (sendResult.sent && sendResult.invoiceId) {
      const fresh = await fetchSalesInvoiceById(sendResult.invoiceId);
      if (fresh) invoice = fresh;
    }
  } catch (err) {
    console.error(
      "[moneybird] auto-send na sync mislukt (webhook gaat door):",
      err instanceof Error ? err.message : err
    );
  }

  // Elke Mollie-order met conceptfactuur → tr_ op de factuurbetaling.
  // (Geen Mollie-tx → no_mollie_payment; andere gateways blijven ongemoeid.)
  try {
    const shopifyOrderId = String(order.id ?? "").trim();
    if (shopifyOrderId && invoice?.id) {
      await registerMolliePaymentOnShopifyInvoice(shopifyOrderId, invoice.id);
    } else if (shopifyOrderId && !invoice?.id) {
      // Update-pad zonder factuur-return: alsnog proberen via reference.
      await registerMolliePaymentOnShopifyInvoice(shopifyOrderId);
    }
  } catch (err) {
    console.error(
      "[moneybird] Mollie payment sync mislukt (webhook gaat door):",
      err instanceof Error ? err.message : err
    );
  }

  return invoice;
}

/**
 * orders/updated|edited: onbetaalde concept → volledige update;
 * betaald + concept + zelfde totaal → concept bijwerken;
 * betaald + concept + ander totaal → concept (nieuwe producten, oude totaal) + delta-correctie;
 * verstuurde hoofdfactuur → add-/credit-concepten bij regelwijzigingen.
 */
async function syncSalesInvoiceOnShopifyOrderUpdate(
  supabase: SupabaseClient,
  order: ShopifyOrder,
  opts?: {
    previousSnapshot?: ShopifyLineSnapshot[] | null;
    previousTotal?: number | null;
  }
): Promise<MoneybirdSalesInvoice | null> {
  if (!isMoneybirdConfigured()) {
    console.warn("[moneybird] niet geconfigureerd — factuur-update overgeslagen.");
    return null;
  }

  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return null;

  const payments = shopifyOrderPaymentAmounts(order);
  const reference = shopifyReferenceForOrderId(shopifyOrderId);
  const existing = await findSalesInvoiceByReference(reference);
  let main = existing?.id
    ? ((await fetchSalesInvoiceById(existing.id)) ?? existing)
    : null;

  // Missende hoofdfactuur (create timeout/lock): alsnog aanmaken op update.
  if (!main) {
    console.info(
      "[moneybird] order update — geen hoofdfactuur, create alsnog",
      reference
    );
    return createSalesInvoiceFromShopifyOrder(supabase, order);
  }

  const nextSnap = buildShopifyLineSnapshot(order);
  const previous = opts?.previousSnapshot;
  const diff =
    previous != null
      ? diffShopifyLineSnapshots(previous, nextSnap)
      : null;
  const hasLineChanges =
    diff != null && (diff.additions.length > 0 || diff.removals.length > 0);
  const paymentOnly =
    diff != null && diff.additions.length === 0 && diff.removals.length === 0;

  const unpaidDraft =
    isDraftMoneybirdInvoice(main) &&
    payments.alBetaald < 0.01;

  if (unpaidDraft) {
    if (paymentOnly) {
      console.info(
        "[moneybird] order update — alleen betaling, concept ongewijzigd",
        reference
      );
      return main;
    }
    // Geen eerdere snapshot: behoud oud gedrag (fingerprint skip in update).
    return updateDraftSalesInvoiceFromShopifyOrder(order);
  }

  const lockedOrPaid =
    payments.alBetaald >= 0.01 ||
    !isDraftMoneybirdInvoice(main);

  if (!lockedOrPaid) {
    console.info(
      "[moneybird] order update — geen lock-pad, skip",
      reference
    );
    return null;
  }

  if (paymentOnly || diff == null || !hasLineChanges) {
    if (paymentOnly) {
      console.info(
        "[moneybird] order update — alleen betaling, geen add/credit",
        reference
      );
    } else if (diff == null) {
      console.info(
        "[moneybird] order update — geen vorige line-snapshot, skip add/credit",
        reference
      );
    }
    return main;
  }

  // Betaald + hoofdfactuur nog concept:
  // - totaal gelijk → concept volledig bijwerken
  // - totaal wijzigt → concept bijwerken met nieuwe producten maar oude totaalprijs,
  //   plus correctiefactuur voor alleen het verschil (negatief = credit).
  if (main != null && isDraftMoneybirdInvoice(main)) {
    const snapTotal = (rows: ShopifyLineSnapshot[]) =>
      rows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0);
    const prevFromOpts =
      opts?.previousTotal != null && Number.isFinite(Number(opts.previousTotal))
        ? Number(opts.previousTotal)
        : null;
    const previousTotal =
      prevFromOpts ??
      (previous != null ? snapTotal(previous) : null);
    const newTotal = payments.totaal;
    const totalsEqual =
      previousTotal != null &&
      Number.isFinite(previousTotal) &&
      Number.isFinite(newTotal) &&
      Math.abs(newTotal - previousTotal) < 0.01;

    if (totalsEqual || previousTotal == null) {
      console.info(
        "[moneybird] order update — concept bijwerken",
        reference,
        totalsEqual ? `(totaal ongewijzigd €${newTotal.toFixed(2)})` : "(geen vorig totaal)"
      );
      return updateDraftSalesInvoiceFromShopifyOrder(order);
    }

    const deltaIncl = Math.round((newTotal - previousTotal) * 100) / 100;
    console.info(
      "[moneybird] order update — concept + correctie delta",
      reference,
      `was €${previousTotal.toFixed(2)} → €${newTotal.toFixed(2)}`,
      `(Δ €${deltaIncl.toFixed(2)})`
    );

    const updatedMain = await updateDraftSalesInvoiceFromShopifyOrder(order, {
      lockTotalIncl: previousTotal,
    });
    const mainForCorr = updatedMain ?? main;

    // Totaal omhoog → nieuw product op correctie (én op hoofdconcept).
    // Totaal omlaag → oud product op negatieve correctie (nieuw staat al op hoofdconcept).
    const lineDescription =
      deltaIncl < 0
        ? (diff.removals[0]?.name && String(diff.removals[0].name).trim()) ||
          (previous?.find((s) => s.qty > 0)?.name &&
            String(previous.find((s) => s.qty > 0)!.name).trim()) ||
          String(order.name ?? shopifyOrderId)
        : (diff.additions[0]?.name && String(diff.additions[0].name).trim()) ||
          (nextSnap.find((s) => s.qty > 0)?.name &&
            String(nextSnap.find((s) => s.qty > 0)!.name).trim()) ||
          String(order.name ?? shopifyOrderId);

    try {
      const correction = await createOrUpdateDeltaCorrectionInvoice({
        order,
        main: mainForCorr,
        deltaIncl,
        lineDescription,
      });
      return correction ?? mainForCorr;
    } catch (err) {
      console.error(
        "[moneybird] correctiefactuur mislukt",
        shopifyOrderId,
        err instanceof Error ? err.message : err
      );
      return mainForCorr;
    }
  }

  // Verstuurde hoofdfactuur (niet meer concept): klassieke add-/credit-concepten.
  let last: MoneybirdSalesInvoice | null = main;

  if (diff.additions.length > 0) {
    try {
      const added = await createAdditionDraftFromSnapshots(order, diff.additions);
      if (added) last = added;
    } catch (err) {
      console.error(
        "[moneybird] add-factuur mislukt",
        shopifyOrderId,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (diff.removals.length > 0 && main?.id) {
    try {
      const credited = await createPartialCreditFromRemovals(
        order,
        main,
        diff.removals
      );
      if (credited) last = credited;
    } catch (err) {
      console.error(
        "[moneybird] credit-factuur mislukt",
        shopifyOrderId,
        err instanceof Error ? err.message : err
      );
    }
  } else if (diff.removals.length > 0 && !main?.id) {
    console.info(
      "[moneybird] removals zonder hoofdfactuur — geen credit",
      shopifyOrderId
    );
  }

  return last;
}

/**
 * Correctiefactuur voor betaald concept: alleen het verschil.
 * deltaIncl > 0 → concept met nieuw product (extra te betalen);
 * deltaIncl < 0 → concept met oud product + negatief bedrag (nieuw staat op hoofdconcept).
 * Kenmerk: "correctie factuur {hoofdnummer}".
 */
async function createOrUpdateDeltaCorrectionInvoice(params: {
  order: ShopifyOrder;
  main: MoneybirdSalesInvoice;
  deltaIncl: number;
  lineDescription: string;
}): Promise<MoneybirdSalesInvoice | null> {
  const shopifyOrderId = String(params.order.id ?? "").trim();
  const deltaIncl = params.deltaIncl;
  if (!shopifyOrderId || Math.abs(deltaIncl) < 0.01) return null;

  const machineRef = shopifyCorrectionReference(shopifyOrderId);
  const kenmerk = correctionKenmerkForMainInvoice(params.main);
  const orderName = String(params.order.name ?? shopifyOrderId).trim();
  const productLabel = String(params.lineDescription ?? "").trim() || "Correctie";
  const absIncl = Math.abs(deltaIncl);
  const signedIncl = deltaIncl; // negatief = credit-achtig
  const { taxRateId, vatMultiplier } = resolveInvoiceTaxForTitle(productLabel);
  const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();
  const priceExcl = signedIncl / vatMultiplier;

  const detail: MoneybirdInvoiceDetailPayload = {
    description: `${productLabel} (${kenmerk}) (${orderName})`,
    price: priceExcl.toFixed(2),
    amount: "1",
    tax_rate_id: taxRateId,
    ledger_account_id: ledgerAccountId,
  };

  const contact = await findOrCreateContactForShopifyOrder(params.order);

  // Idempotent: vaste machine-reference per Shopify-order.
  let existing =
    (await findSalesInvoiceByReference(machineRef)) ??
    (await findSalesInvoiceByReference(kenmerk));

  if (existing?.id) {
    const full = (await fetchSalesInvoiceById(existing.id)) ?? existing;
    if (!isDraftMoneybirdInvoice(full)) {
      console.info(
        "[moneybird] correctie niet meer concept — skip update",
        full.id,
        full.state
      );
      return full;
    }
    const destroyOld = (full.details ?? [])
      .filter((d) => d.id)
      .map((d) => ({ id: d.id, _destroy: "1" as const }));
    const updated = await moneybirdFetch<MoneybirdSalesInvoice>(
      `/sales_invoices/${full.id}.json`,
      {
        method: "PATCH",
        body: JSON.stringify({
          sales_invoice: {
            contact_id: contact.id,
            reference: kenmerk,
            details_attributes: [...destroyOld, detail],
          },
        }),
      }
    );
    console.info(
      "[moneybird] correctie-concept bijgewerkt",
      updated.id,
      kenmerk,
      `€${deltaIncl.toFixed(2)}`
    );
    return updated;
  }

  const created = await moneybirdFetch<MoneybirdSalesInvoice>(
    "/sales_invoices.json",
    {
      method: "POST",
      body: JSON.stringify({
        sales_invoice: {
          contact_id: contact.id,
          // Kenmerk: "correctie factuur {hoofdnummer}". (Geen shopify:-prefix → geen voorraadaftrek.)
          reference: kenmerk,
          currency: "EUR",
          prices_are_incl_tax: false,
          details_attributes: [detail],
        },
      }),
    }
  );

  console.info(
    "[moneybird] correctie-concept aangemaakt",
    created.id,
    kenmerk,
    `€${deltaIncl.toFixed(2)}`,
    `(abs €${absIncl.toFixed(2)})`
  );
  return created;
}

/** Nieuwe conceptfactuur alleen voor toegevoegde regels (geen main-order lock). */
async function createAdditionDraftFromSnapshots(
  order: ShopifyOrder,
  additions: ShopifyLineSnapshot[]
): Promise<MoneybirdSalesInvoice | null> {
  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId || additions.length === 0) return null;

  const reference = shopifyAdditionReference(shopifyOrderId, additions);
  const existing = await findSalesInvoiceByReference(reference);
  if (existing?.id) {
    console.info(
      "[moneybird] add-factuur bestaat al",
      reference,
      existing.id
    );
    return existing;
  }

  const details = await buildInvoiceDetailsFromLineSnapshots(order, additions);
  if (!details) {
    console.warn("[moneybird] add-factuur — geen regels", reference);
    return null;
  }

  const contact = await findOrCreateContactForShopifyOrder(order);
  const created = await moneybirdFetch<MoneybirdSalesInvoice>(
    "/sales_invoices.json",
    {
      method: "POST",
      body: JSON.stringify({
        sales_invoice: {
          contact_id: contact.id,
          reference,
          currency: "EUR",
          prices_are_incl_tax: false,
          details_attributes: details,
        },
      }),
    }
  );

  console.info(
    "[moneybird] add-conceptfactuur aangemaakt",
    created.id,
    reference,
    `(${additions.length} regels)`
  );
  return created;
}

/**
 * Deelcredit: duplicate_creditinvoice van hoofdfactuur, daarna alleen removal-regels.
 * Blijft concept (niet auto-verzenden).
 */
async function createPartialCreditFromRemovals(
  order: ShopifyOrder,
  mainInvoice: MoneybirdSalesInvoice,
  removals: ShopifyLineSnapshot[]
): Promise<MoneybirdSalesInvoice | null> {
  const shopifyOrderId = String(order.id ?? "").trim();
  const mainId = String(mainInvoice.id ?? "").trim();
  if (!shopifyOrderId || !mainId || removals.length === 0) return null;

  const reference = shopifyCreditReference(shopifyOrderId, removals);
  const existing = await findSalesInvoiceByReference(reference);
  if (existing?.id) {
    console.info(
      "[moneybird] credit-factuur bestaat al",
      reference,
      existing.id
    );
    return existing;
  }

  const details = await buildInvoiceDetailsFromLineSnapshots(order, removals);
  if (!details) {
    console.warn("[moneybird] credit — geen removal-regels", reference);
    return null;
  }

  const duplicated = await moneybirdFetch<MoneybirdSalesInvoice>(
    `/sales_invoices/${mainId}/duplicate_creditinvoice.json`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    }
  );
  if (!duplicated?.id) {
    console.error("[moneybird] duplicate_creditinvoice gaf geen id", mainId);
    return null;
  }

  const full = (await fetchSalesInvoiceById(duplicated.id)) ?? duplicated;
  const samplePrice = parseMoneyAmount(full.details?.[0]?.price);
  const useNegativePrices = Number.isFinite(samplePrice) && samplePrice < 0;

  const destroyOld = (full.details ?? [])
    .filter((d) => d.id)
    .map((d) => ({ id: d.id, _destroy: "1" as const }));

  const creditDetails = details.map((d) => {
    const priceAbs = Math.abs(parseFloat(d.price) || 0);
    return {
      ...d,
      price: useNegativePrices
        ? (-priceAbs).toFixed(2)
        : priceAbs.toFixed(2),
    };
  });

  const updated = await moneybirdFetch<MoneybirdSalesInvoice>(
    `/sales_invoices/${full.id}.json`,
    {
      method: "PATCH",
      body: JSON.stringify({
        sales_invoice: {
          reference,
          details_attributes: [...destroyOld, ...creditDetails],
        },
      }),
    }
  );

  console.info(
    "[moneybird] credit-conceptfactuur aangemaakt",
    updated.id ?? full.id,
    reference,
    `van hoofdfactuur ${mainId}`
  );
  return updated;
}

/**
 * Volledige refund/cancel:
 * - onbetaald + concept → concept verwijderen
 * - betaald (ook als concept) → concept laten staan, full credit-concept aanmaken
 * - niet-concept (verstuurd) → full credit-concept (ongeacht betaling)
 */
export async function creditSalesInvoiceForShopifyOrderFullRefund(
  shopifyOrderId: string,
  opts?: { wasPaid?: boolean }
): Promise<{
  credited: boolean;
  deleted?: boolean;
  invoiceId?: string;
  creditInvoiceId?: string;
  skipped?: string;
  error?: string;
}> {
  if (!isMoneybirdConfigured()) {
    return { credited: false, error: "moneybird_not_configured" };
  }
  const id = String(shopifyOrderId ?? "").trim();
  if (!id) return { credited: false, error: "missing_shopify_order_id" };

  const reference = shopifyReferenceForOrderId(id);
  const existing = await findSalesInvoiceByReference(reference);
  if (!existing?.id) {
    return { credited: false, skipped: "no_invoice" };
  }

  const full = (await fetchSalesInvoiceById(existing.id)) ?? existing;
  const wasPaid = Boolean(opts?.wasPaid);
  const isDraft = isDraftMoneybirdInvoice(full);

  // Onbetaald concept: weghalen. Betaald concept blijft staan + credit hieronder.
  if (isDraft && !wasPaid) {
    const del = await deleteSalesInvoiceForShopifyOrderId(id);
    return {
      credited: false,
      deleted: del.deleted,
      invoiceId: del.invoiceId ?? full.id,
      skipped: del.skipped,
      error: del.error,
    };
  }

  const creditRef = shopifyFullCreditReference(id);
  const existingCredit = await findSalesInvoiceByReference(creditRef);
  if (existingCredit?.id) {
    console.info(
      "[moneybird] full credit bestaat al",
      creditRef,
      existingCredit.id
    );
    return {
      credited: false,
      invoiceId: full.id,
      creditInvoiceId: existingCredit.id,
      skipped: "credit_exists",
    };
  }

  try {
    const duplicated = await moneybirdFetch<MoneybirdSalesInvoice>(
      `/sales_invoices/${full.id}/duplicate_creditinvoice.json`,
      {
        method: "PATCH",
        body: JSON.stringify({}),
      }
    );
    if (!duplicated?.id) {
      return {
        credited: false,
        invoiceId: full.id,
        error: "duplicate_creditinvoice_no_id",
      };
    }

    const updated = await moneybirdFetch<MoneybirdSalesInvoice>(
      `/sales_invoices/${duplicated.id}.json`,
      {
        method: "PATCH",
        body: JSON.stringify({
          sales_invoice: { reference: creditRef },
        }),
      }
    );

    console.info(
      "[moneybird] full credit-concept aangemaakt",
      updated.id ?? duplicated.id,
      creditRef,
      `van ${full.id}`,
      wasPaid ? "(betaalde order)" : "(niet-concept)"
    );
    return {
      credited: true,
      invoiceId: full.id,
      creditInvoiceId: updated.id ?? duplicated.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[moneybird] full credit mislukt", full.id, msg);
    return { credited: false, invoiceId: full.id, error: msg };
  }
}

/**
 * Verwijder Moneybird-conceptfactuur voor een Shopify-order (reference shopify:{id}).
 * Alleen state=draft — verstuurde/open facturen blijven staan.
 */
export async function deleteSalesInvoiceForShopifyOrderId(
  shopifyOrderId: string
): Promise<{ deleted: boolean; invoiceId?: string; skipped?: string; error?: string }> {
  if (!isMoneybirdConfigured()) {
    return { deleted: false, error: "moneybird_not_configured" };
  }
  const id = String(shopifyOrderId ?? "").trim();
  if (!id) return { deleted: false, error: "missing_shopify_order_id" };

  const reference = shopifyReferenceForOrderId(id);
  const existing = await findSalesInvoiceByReference(reference);
  if (!existing?.id) {
    return { deleted: false };
  }

  const full = (await fetchSalesInvoiceById(existing.id)) ?? existing;
  if (!isDraftMoneybirdInvoice(full)) {
    console.info(
      "[moneybird] factuur niet verwijderd — geen concept meer",
      full.id,
      full.state ?? "?",
      "voor",
      reference
    );
    return { deleted: false, invoiceId: full.id, skipped: `state_${full.state ?? "unknown"}` };
  }

  try {
    await moneybirdFetch<unknown>(`/sales_invoices/${full.id}.json`, {
      method: "DELETE",
    });
    console.info("[moneybird] conceptfactuur verwijderd", full.id, "voor", reference);
    return { deleted: true, invoiceId: full.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[moneybird] conceptfactuur verwijderen mislukt", full.id, msg);
    return { deleted: false, invoiceId: full.id, error: msg };
  }
}

/**
 * Maakt een sales invoice in Moneybird voor een Shopify-order.
 * Reference = shopify:{id} zodat de Moneybird-webhook dubbele voorraadaftrek kan skippen.
 *
 * Altijd als concept. Auto-mail gebeurt apart bij fulfillment_status=fulfilled
 * én totaal < €490. Totaal €0: geen factuur.
 */
export async function createSalesInvoiceFromShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<MoneybirdSalesInvoice | null> {
  if (!isMoneybirdConfigured()) {
    console.warn("[moneybird] niet geconfigureerd — factuur overgeslagen.");
    return null;
  }

  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return null;

  const totalIncl = shopifyOrderBillableTotalIncl(order);
  if (isZeroInvoiceTotal(totalIncl)) {
    console.info(
      "[moneybird] order totaal €0 — geen factuur",
      shopifyOrderId,
      order.name ?? "",
      `(berekend: €${totalIncl.toFixed(2)})`
    );
    return null;
  }

  const reference = shopifyReferenceForOrderId(shopifyOrderId);
  let lock = await acquireMoneybirdShopifyInvoiceLock(supabase, shopifyOrderId);
  if (lock === "existing") {
    const existing = await findSalesInvoiceByReferenceWithRetry(reference);
    if (existing) {
      console.info(
        "[moneybird] factuur bestaat al (lock) voor",
        reference,
        "— skip create",
        existing.id
      );
      return existing;
    }
    // Vastgelopen lock (timeout vóór POST) → vrijgeven en opnieuw proberen.
    console.warn(
      "[moneybird] stale invoice lock zonder factuur — release + retry",
      reference
    );
    await releaseMoneybirdShopifyInvoiceLock(supabase, shopifyOrderId);
    lock = await acquireMoneybirdShopifyInvoiceLock(supabase, shopifyOrderId);
    if (lock === "existing") {
      const again = await findSalesInvoiceByReference(reference);
      if (again) return again;
      console.warn(
        "[moneybird] lock opnieuw bezet zonder factuur — skip create",
        reference
      );
      return null;
    }
  }

  let created: MoneybirdSalesInvoice | null = null;
  try {
    const existing = await findSalesInvoiceByReference(reference);
    if (existing) {
      console.info(
        "[moneybird] factuur bestaat al voor",
        reference,
        "— skip create",
        existing.id
      );
      created = existing;
      return existing;
    }

    const contact = await findOrCreateContactForShopifyOrder(order);
    const orderName = String(order.name ?? shopifyOrderId).trim();

    const details = await buildInvoiceDetailsFromShopifyOrder(order);
    if (!details) {
      console.warn("[moneybird] geen factuurregels voor order", shopifyOrderId);
      return null;
    }

    const payload = {
      sales_invoice: {
        contact_id: contact.id,
        reference,
        currency: "EUR",
        prices_are_incl_tax: false,
        details_attributes: details,
      },
    };

    created = await moneybirdFetch<MoneybirdSalesInvoice>("/sales_invoices.json", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    console.info(
      "[moneybird] draft factuur aangemaakt",
      created.id,
      "voor Shopify",
      orderName,
      Number.isFinite(totalIncl) ? `(totaal €${totalIncl.toFixed(2)})` : ""
    );

    // Mollie tr_ gebeurt één keer in syncSalesInvoiceFromShopifyOrder (niet hier dubbel).
    return created;
  } finally {
    if (created?.id) {
      if (lock === "acquired") {
        await storeMoneybirdShopifyInvoiceId(supabase, shopifyOrderId, created.id);
      }
    } else if (lock === "acquired") {
      await releaseMoneybirdShopifyInvoiceLock(supabase, shopifyOrderId);
    }
  }
}

export type MoneybirdProduct = {
  id: string;
  identifier?: string | null;
  description?: string | null;
  title?: string | null;
  price?: string | null;
  currency?: string | null;
  tax_rate_id?: string | null;
  ledger_account_id?: string | null;
};

/** Zelfde conventie als bestaande Moneybird-catalogus: identifier = Shopify product-id. */
export function shopifyProductIdentifier(shopifyProductId: string | number): string {
  return String(shopifyProductId).trim();
}

export async function findProductByIdentifier(
  identifier: string
): Promise<MoneybirdProduct | null> {
  const enc = encodeURIComponent(identifier);
  try {
    return await moneybirdFetch<MoneybirdProduct>(`/products/identifier/${enc}.json`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Moneybird 404")) return null;
    throw err;
  }
}

export async function fetchMoneybirdProductById(
  productId: string
): Promise<MoneybirdProduct | null> {
  const id = String(productId ?? "").trim();
  if (!id) return null;
  try {
    return await moneybirdFetch<MoneybirdProduct>(`/products/${id}.json`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Moneybird 404")) return null;
    throw err;
  }
}

function firstVariantPrice(product: ShopifyAdminProduct): string {
  const raw = product.variants?.[0]?.price;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return n.toFixed(2);
}

/**
 * Producten die in Moneybird op 9% btw moeten blijven (niet de standaard 21%).
 * Match op Shopify-/Moneybird-titel.
 */
export function isMoneybirdReducedVatProductTitle(title: string): boolean {
  const n = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return false;
  if (/^volledig rijklaar\b/.test(n)) return true;
  if (/^arbeidskosten\b/.test(n)) return true;
  if (n.includes("onderhoudspakket") && /(goud|zilver|brons|bronze)/.test(n)) {
    return true;
  }
  return false;
}

function moneybirdTaxRateIdForProductTitle(
  title: string,
  existingTaxRateId?: string | null
): string | null {
  const defaultId = process.env.MONEYBIRD_TAX_RATE_ID?.trim() || "";
  if (!isMoneybirdReducedVatProductTitle(title)) {
    return defaultId || null;
  }
  const ninePct = moneybirdNinePercentTaxRateId();
  if (ninePct) return ninePct;
  // Geen 9%-env: behoud bestaande rate bij update i.p.v. terugzetten naar 21%.
  const existing = String(existingTaxRateId ?? "").trim();
  if (existing) return existing;
  return null;
}

/**
 * Upsert Moneybird-product voor een actief Shopify-product.
 * Draft/archived → verwijderen/deactiveren.
 */
export async function upsertMoneybirdProductFromShopify(
  product: ShopifyAdminProduct
): Promise<{ action: "created" | "updated" | "removed" | "skipped"; productId?: string }> {
  if (!isMoneybirdConfigured()) {
    return { action: "skipped" };
  }

  const shopifyProductId = Number(product.id);
  if (!Number.isFinite(shopifyProductId) || shopifyProductId <= 0) {
    return { action: "skipped" };
  }

  if (!isShopifyProductActive(product)) {
    const removed = await removeMoneybirdProductForShopifyId(shopifyProductId);
    return {
      action: removed.removed ? "removed" : "skipped",
      productId: removed.productId,
    };
  }

  const identifier = shopifyProductIdentifier(shopifyProductId);
  const description = String(product.title ?? "").trim() || `Shopify ${identifier}`;
  const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();
  const existing = await findProductByIdentifier(identifier);
  const taxRateId = moneybirdTaxRateIdForProductTitle(
    description,
    existing?.tax_rate_id
  );

  if (isMoneybirdReducedVatProductTitle(description) && !taxRateId) {
    console.warn(
      "[moneybird] 9% btw-product zonder MONEYBIRD_TAX_RATE_ID_9 en zonder bestaande tax_rate — tax_rate_id weggelaten:",
      description
    );
  }

  const productBody: Record<string, string> = {
    identifier,
    description,
    price: firstVariantPrice(product),
    currency: "EUR",
    ledger_account_id: ledgerAccountId,
  };
  if (taxRateId) {
    productBody.tax_rate_id = taxRateId;
  }

  const payload = { product: productBody };

  if (existing?.id) {
    const updated = await moneybirdFetch<MoneybirdProduct>(`/products/${existing.id}.json`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    console.info("[moneybird] product bijgewerkt", updated.id, identifier, description);
    return { action: "updated", productId: updated.id };
  }

  const created = await moneybirdFetch<MoneybirdProduct>("/products.json", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  console.info("[moneybird] product aangemaakt", created.id, identifier, description);
  return { action: "created", productId: created.id };
}

/** Verwijder/deactiveer Moneybird-product gekoppeld aan Shopify product-id. */
export async function removeMoneybirdProductForShopifyId(
  shopifyProductId: string | number
): Promise<{ removed: boolean; productId?: string }> {
  if (!isMoneybirdConfigured()) return { removed: false };

  const identifier = shopifyProductIdentifier(shopifyProductId);
  if (!identifier) return { removed: false };

  const existing = await findProductByIdentifier(identifier);
  if (!existing?.id) return { removed: false };

  try {
    await moneybirdFetch<unknown>(`/products/${existing.id}.json`, { method: "DELETE" });
    console.info("[moneybird] product verwijderd/gedeactiveerd", existing.id, identifier);
    return { removed: true, productId: existing.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Moneybird 404")) return { removed: false };
    throw err;
  }
}

/** Reference voor reparatie-orders (geen Shopify-id). */
export function reparatieReferenceForOrderId(orderId: string): string {
  return `reparatie:${String(orderId ?? "").trim()}`;
}

export function parseReparatieOrderIdFromReference(
  reference: string | null | undefined
): string | null {
  const raw = String(reference ?? "").trim();
  const m = raw.match(/^reparatie:([0-9a-f-]{36})\b/i);
  return m?.[1] ?? null;
}

export type ReparatieInvoiceContactInput = {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  address1?: string;
  zipcode?: string;
  city?: string;
};

export type ReparatieInvoiceLineInput = {
  description: string;
  /** Prijs incl. BTW. */
  priceIncl: number;
  quantity?: number;
  shopifyProductId?: number | null;
};

/**
 * Bouw Moneybird-factuurdetails vanuit reparatie-regels (mixed 9%/21%).
 */
export function buildInvoiceDetailsFromReparatieLines(
  lines: ReparatieInvoiceLineInput[],
  orderLabel: string
): MoneybirdInvoiceDetailPayload[] {
  const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();
  const details: MoneybirdInvoiceDetailPayload[] = [];
  const label = String(orderLabel ?? "").trim() || "reparatie";

  for (const line of lines) {
    const description = String(line.description ?? "").trim();
    if (!description) continue;
    const qty = Math.max(1, Math.floor(Number(line.quantity ?? 1)));
    const unitIncl = Number(line.priceIncl);
    // €0 toegestaan (garantie / lege reparatie-factuur).
    if (!Number.isFinite(unitIncl) || unitIncl < 0) continue;
    const { taxRateId, vatMultiplier } = resolveInvoiceTaxForTitle(description);
    details.push({
      description: `${description} (${label})`,
      price: unitPriceExclApprox(unitIncl, vatMultiplier),
      amount: String(qty),
      tax_rate_id: taxRateId,
      ledger_account_id: ledgerAccountId,
    });
  }
  return details;
}

/**
 * Maak of update conceptfactuur voor een reparatie-order.
 * Reference = reparatie:{uuid}. Contant-pad: niet aanroepen / deleteReparatieInvoice.
 */
export async function upsertReparatieSalesInvoice(params: {
  orderId: string;
  orderNummer: string;
  contact: ReparatieInvoiceContactInput;
  lines: ReparatieInvoiceLineInput[];
  existingInvoiceId?: string | null;
}): Promise<MoneybirdSalesInvoice | null> {
  if (!isMoneybirdConfigured()) {
    console.warn("[moneybird] niet geconfigureerd — reparatie-factuur overgeslagen.");
    return null;
  }

  const orderId = String(params.orderId ?? "").trim();
  if (!orderId) return null;

  const details = buildInvoiceDetailsFromReparatieLines(
    params.lines,
    params.orderNummer || orderId
  );
  // Ook €0-factuur: lege details → één €0-regel zodat concept wel bestaat.
  if (details.length === 0) {
    const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();
    const { taxRateId } = resolveInvoiceTaxForTitle("Reparatie");
    details.push({
      description: `Reparatie (${params.orderNummer || orderId})`,
      price: "0.00",
      amount: "1",
      tax_rate_id: taxRateId,
      ledger_account_id: ledgerAccountId,
    });
  }

  const email =
    String(params.contact.email ?? "").trim().toLowerCase() ||
    "onbekend@koopjefatbike.nl";
  let contact = await findContactByEmail(email);
  if (!contact) {
    contact = await createContact({
      email,
      firstname: params.contact.firstname ?? "",
      lastname: params.contact.lastname ?? "Klant",
      phone: params.contact.phone ?? "",
      address1: params.contact.address1 ?? "",
      zipcode: params.contact.zipcode ?? "",
      city: params.contact.city ?? "",
      country: "NL",
    });
  }

  const reference = reparatieReferenceForOrderId(orderId);
  const existingId = String(params.existingInvoiceId ?? "").trim();
  let existing: MoneybirdSalesInvoice | null = null;
  if (existingId) {
    existing = await fetchSalesInvoiceById(existingId);
  }
  if (!existing) {
    existing = await findSalesInvoiceByReference(reference);
  }

  if (existing?.id) {
    const full = (await fetchSalesInvoiceById(existing.id)) ?? existing;
    if (!isDraftMoneybirdInvoice(full)) {
      console.info(
        "[moneybird] reparatie-factuur niet meer concept — skip update",
        full.id,
        full.state
      );
      return full;
    }

    // Vergelijk regels: bij gelijke inhoud geen PATCH (voorkomt dubbele regels).
    if (invoiceDetailsUnchanged(full.details, details)) {
      console.info(
        "[moneybird] reparatie conceptfactuur al in sync, skip",
        full.id,
        reference
      );
      return full;
    }

    // Oude regels vernietigen + nieuwe zetten (PATCH zonder _destroy voegt toe).
    const destroyOld = (full.details ?? [])
      .filter((d) => d.id)
      .map((d) => ({ id: d.id, _destroy: "1" as const }));

    const updated = await moneybirdFetch<MoneybirdSalesInvoice>(
      `/sales_invoices/${full.id}.json`,
      {
        method: "PATCH",
        body: JSON.stringify({
          sales_invoice: {
            contact_id: contact.id,
            reference,
            details_attributes: [...destroyOld, ...details],
          },
        }),
      }
    );
    console.info("[moneybird] reparatie conceptfactuur bijgewerkt", updated.id, reference);
    return updated;
  }

  const created = await moneybirdFetch<MoneybirdSalesInvoice>("/sales_invoices.json", {
    method: "POST",
    body: JSON.stringify({
      sales_invoice: {
        contact_id: contact.id,
        reference,
        currency: "EUR",
        prices_are_incl_tax: false,
        details_attributes: details,
      },
    }),
  });
  console.info("[moneybird] reparatie conceptfactuur aangemaakt", created.id, reference);
  return created;
}

export async function deleteReparatieSalesInvoice(params: {
  orderId: string;
  invoiceId?: string | null;
}): Promise<{ deleted: boolean; invoiceId?: string; skipped?: string }> {
  if (!isMoneybirdConfigured()) {
    return { deleted: false, skipped: "moneybird_not_configured" };
  }
  const orderId = String(params.orderId ?? "").trim();
  const reference = reparatieReferenceForOrderId(orderId);
  let existing: MoneybirdSalesInvoice | null = null;
  const invId = String(params.invoiceId ?? "").trim();
  if (invId) existing = await fetchSalesInvoiceById(invId);
  if (!existing) existing = await findSalesInvoiceByReference(reference);
  if (!existing?.id) return { deleted: false };

  if (!isDraftMoneybirdInvoice(existing)) {
    return {
      deleted: false,
      invoiceId: existing.id,
      skipped: `state_${existing.state ?? "unknown"}`,
    };
  }

  await moneybirdFetch<unknown>(`/sales_invoices/${existing.id}.json`, {
    method: "DELETE",
  });
  console.info("[moneybird] reparatie conceptfactuur verwijderd", existing.id, reference);
  return { deleted: true, invoiceId: existing.id };
}

/**
 * Moneybird-hoofdfactuur betaald → Shopify-order + ritjes-rijen als betaald markeren.
 * Alleen reference `shopify:{id}` (geen add/credit). Voorraad blijft via aparte deduct-path.
 */
export async function markOrdersPaidFromMoneybirdShopifyInvoice(
  supabase: SupabaseClient,
  invoice: MoneybirdSalesInvoice
): Promise<{
  updated: number;
  shopifyOrderId: string | null;
  shopifyMarked: boolean;
  skipped?: string;
  shopifyError?: string;
}> {
  const shopifyOrderId = parseMainShopifyOrderIdFromInvoiceReference(
    invoice.reference
  );
  if (!shopifyOrderId) {
    return {
      updated: 0,
      shopifyOrderId: null,
      shopifyMarked: false,
      skipped: "not_main_shopify_ref",
    };
  }

  const state = String(invoice.state ?? "").trim().toLowerCase();
  if (state && state !== "paid") {
    return {
      updated: 0,
      shopifyOrderId,
      shopifyMarked: false,
      skipped: `state_${state}`,
    };
  }

  const { data: rows, error: readErr } = await supabase
    .from("orders")
    .select("id, bestelling_totaal_prijs, al_betaald, te_betalen, betaald")
    .eq("source", "shopify")
    .eq("order_id", shopifyOrderId);

  if (readErr) {
    throw new Error(`Orders ophalen mislukt: ${readErr.message}`);
  }

  let updated = 0;
  for (const row of rows ?? []) {
    const totaal = Number(row.bestelling_totaal_prijs) || 0;
    const teBetalen = Number(row.te_betalen);
    const alreadyPaid =
      Boolean(row.betaald) &&
      (Number.isFinite(teBetalen) ? teBetalen < 0.01 : true);
    if (alreadyPaid && Math.abs(Number(row.al_betaald) - totaal) < 0.01) {
      continue;
    }
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        betaald: true,
        al_betaald: totaal,
        te_betalen: 0,
      })
      .eq("id", row.id);
    if (updErr) {
      console.error(
        "[moneybird] order betaald markeren mislukt",
        row.id,
        updErr.message
      );
      continue;
    }
    updated += 1;
  }

  const shopifyResult = await markShopifyOrderAsPaid(shopifyOrderId);
  if (!shopifyResult.ok && shopifyResult.error) {
    console.error(
      "[moneybird] Shopify markAsPaid mislukt",
      shopifyOrderId,
      shopifyResult.error
    );
  } else if (shopifyResult.ok) {
    console.info(
      "[moneybird] Shopify-order als betaald gemarkeerd",
      shopifyOrderId,
      shopifyResult.skipped ?? ""
    );
  }

  console.info(
    "[moneybird] ritjes betaald na Moneybird-factuur",
    shopifyOrderId,
    `updated=${updated}`,
    invoice.id
  );

  return {
    updated,
    shopifyOrderId,
    shopifyMarked: Boolean(shopifyResult.ok),
    skipped: updated === 0 && shopifyResult.skipped ? shopifyResult.skipped : undefined,
    shopifyError: shopifyResult.error,
  };
}

/**
 * Verstuur reparatie-conceptfactuur (draft → open) per e-mail.
 * No-op als factuur al geen concept meer is.
 */
export async function sendReparatieSalesInvoice(params: {
  orderId: string;
  invoiceId?: string | null;
  email?: string | null;
}): Promise<{ sent: boolean; invoiceId?: string; skipped?: string }> {
  if (!isMoneybirdConfigured()) {
    return { sent: false, skipped: "moneybird_not_configured" };
  }
  const orderId = String(params.orderId ?? "").trim();
  if (!orderId) return { sent: false, skipped: "missing_order_id" };

  const reference = reparatieReferenceForOrderId(orderId);
  let existing: MoneybirdSalesInvoice | null = null;
  const invId = String(params.invoiceId ?? "").trim();
  if (invId) existing = await fetchSalesInvoiceById(invId);
  if (!existing) existing = await findSalesInvoiceByReference(reference);
  if (!existing?.id) return { sent: false, skipped: "no_invoice" };

  const full = (await fetchSalesInvoiceById(existing.id)) ?? existing;
  if (!isDraftMoneybirdInvoice(full)) {
    return {
      sent: false,
      invoiceId: full.id,
      skipped: `state_${String(full.state ?? "unknown").toLowerCase()}`,
    };
  }

  const sent = await sendSalesInvoiceByEmail(full.id, {
    emailAddress: params.email,
  });
  console.info(
    "[moneybird] reparatie factuur verzonden",
    sent.id ?? full.id,
    reference
  );
  return { sent: true, invoiceId: sent.id ?? full.id };
}
