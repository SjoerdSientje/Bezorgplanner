/**
 * Moneybird API-client (sales invoices + webhook signature).
 * @see https://developer.moneybird.com/
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMalyarTestOrderNote } from "@/lib/account";
import type { ShopifyLineItem, ShopifyOrder, ShopifyShippingLine } from "@/lib/shopify-order";
import {
  isShopifyProductActive,
  type ShopifyAdminProduct,
} from "@/lib/shopify-admin";

const MONEYBIRD_API_BASE = "https://moneybird.com/api/v2";

/** Shopify-ordertotaal (incl. BTW) onder dit bedrag → factuur direct permanent (open). */
export const AUTO_FINALIZE_INVOICE_BELOW_EUR = 498;

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

export type MoneybirdSalesInvoice = {
  id: string;
  invoice_id?: string | null;
  reference?: string | null;
  state?: string | null;
  contact_id?: string | null;
  details?: MoneybirdSalesInvoiceDetail[] | null;
};

/** Machine-leesbare Shopify-koppeling op factuur.reference. */
export function shopifyReferenceForOrderId(shopifyOrderId: string): string {
  return `shopify:${shopifyOrderId}`;
}

export function parseShopifyOrderIdFromReference(
  reference: string | null | undefined
): string | null {
  const raw = String(reference ?? "").trim();
  const m = raw.match(/^shopify:(\d+)\b/i);
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
  attempts = 8,
  delayMs = 400
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

function unitPriceExclApprox(price: string | number | null | undefined): string {
  const n =
    typeof price === "string" ? parseFloat(price) : Number(price ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0.00";
  // Shopify prices in NL shop are typically incl. BTW; Moneybird price is excl.
  // Gebruik 21% standaardaftrek zodat factuurtotaal ongeveer klopt.
  const excl = n / 1.21;
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
  const qty = Math.max(1, Math.floor(Number(li.quantity ?? 1)));
  if (!Number.isFinite(price)) return 0;
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
  const qty = Math.max(1, Math.floor(Number(li.quantity ?? 1)));
  return lineItemNetTotalIncl(li) / qty;
}

function shippingLineNetTotalIncl(line: ShopifyShippingLine): number {
  const discounted = parseMoneyAmount(line.discounted_price);
  if (Number.isFinite(discounted)) return Math.max(0, discounted);
  const price = parseMoneyAmount(line.price);
  return Number.isFinite(price) ? Math.max(0, price) : 0;
}

function invoiceDetailLineTotalIncl(detail: MoneybirdInvoiceDetailPayload): number {
  const excl = (parseFloat(detail.price) || 0) * (parseFloat(detail.amount) || 0);
  return excl * 1.21;
}

/** Ordertotaal incl. BTW — total_price, current_total_price of som van regels. */
export function shopifyOrderBillableTotalIncl(order: ShopifyOrder): number {
  const fromTotal = parseMoneyAmount(order.total_price);
  const fromCurrent = parseMoneyAmount(order.current_total_price);
  const lineSum = (order.line_items ?? []).reduce(
    (sum, li) => sum + lineItemNetTotalIncl(li),
    0
  );
  const shippingSum = (order.shipping_lines ?? []).reduce(
    (sum, sl) => sum + shippingLineNetTotalIncl(sl),
    0
  );

  if (Number.isFinite(fromTotal)) return Math.max(0, fromTotal);
  if (Number.isFinite(fromCurrent)) return Math.max(0, fromCurrent);
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
};

function buildInvoiceDetailsFromShopifyOrder(
  order: ShopifyOrder
): MoneybirdInvoiceDetailPayload[] | null {
  const shopifyOrderId = String(order.id ?? "").trim();
  const taxRateId = process.env.MONEYBIRD_TAX_RATE_ID!.trim();
  const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();
  const orderName = String(order.name ?? shopifyOrderId).trim();

  const details: MoneybirdInvoiceDetailPayload[] = [];

  for (const li of order.line_items ?? []) {
    const description = String(li.name ?? "").trim();
    if (!description) continue;
    const unitIncl = lineItemUnitPriceIncl(li);
    if (unitIncl < 0.01) continue;
    const amount = Math.max(1, Math.floor(Number(li.quantity ?? 1)));
    details.push({
      description: `${description} (${orderName})`,
      price: unitPriceExclApprox(unitIncl),
      amount: String(amount),
      tax_rate_id: taxRateId,
      ledger_account_id: ledgerAccountId,
    });
  }

  for (const sl of order.shipping_lines ?? []) {
    const shippingIncl = shippingLineNetTotalIncl(sl);
    if (shippingIncl < 0.01) continue;
    const title = String(sl.title ?? "Verzendkosten").trim() || "Verzendkosten";
    details.push({
      description: `${title} (${orderName})`,
      price: unitPriceExclApprox(shippingIncl),
      amount: "1",
      tax_rate_id: taxRateId,
      ledger_account_id: ledgerAccountId,
    });
  }

  if (details.length === 0) return null;

  const targetIncl = shopifyOrderBillableTotalIncl(order);
  if (targetIncl >= 0.01) {
    const builtIncl = details.reduce((sum, d) => sum + invoiceDetailLineTotalIncl(d), 0);
    const diffIncl = Math.round((builtIncl - targetIncl) * 100) / 100;
    if (diffIncl > 0.01) {
      details.push({
        description: `Korting (${orderName})`,
        price: (-diffIncl / 1.21).toFixed(2),
        amount: "1",
        tax_rate_id: taxRateId,
        ledger_account_id: ledgerAccountId,
      });
    } else if (diffIncl < -0.01) {
      details.push({
        description: `Aanpassing (${orderName})`,
        price: (-diffIncl / 1.21).toFixed(2),
        amount: "1",
        tax_rate_id: taxRateId,
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

function isDraftMoneybirdInvoice(invoice: MoneybirdSalesInvoice): boolean {
  return String(invoice.state ?? "").toLowerCase() === "draft";
}

/**
 * orders/updated: alleen bestaande conceptfactuur bijwerken — nooit een nieuwe aanmaken.
 */
export async function updateDraftSalesInvoiceFromShopifyOrder(
  order: ShopifyOrder
): Promise<MoneybirdSalesInvoice | null> {
  if (!isMoneybirdConfigured()) {
    console.warn("[moneybird] niet geconfigureerd — factuur-update overgeslagen.");
    return null;
  }

  const shopifyOrderId = String(order.id ?? "").trim();
  if (!shopifyOrderId) return null;

  if (isZeroInvoiceTotal(shopifyOrderBillableTotalIncl(order))) {
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

  const details = buildInvoiceDetailsFromShopifyOrder(order);
  if (!details) {
    console.warn("[moneybird] order update — geen factuurregels", shopifyOrderId);
    return null;
  }

  const contact = await findOrCreateContactForShopifyOrder(order);
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
 * Routeert Moneybird-factuuractie op Shopify-webhook topic.
 * - orders/create → nieuwe factuur (indien van toepassing)
 * - orders/updated → alleen bestaande conceptfactuur bijwerken
 */
export async function syncSalesInvoiceFromShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrder,
  topic: string
): Promise<MoneybirdSalesInvoice | null> {
  const normalizedTopic = topic.trim().toLowerCase();
  if (normalizedTopic === "orders/updated") {
    return updateDraftSalesInvoiceFromShopifyOrder(order);
  }
  if (normalizedTopic === "orders/create") {
    return createSalesInvoiceFromShopifyOrder(supabase, order);
  }
  return null;
}

/**
 * Verwijder Moneybird-factuur voor een Shopify-order (reference shopify:{id}).
 * Concepten worden verwijderd; openstaande/verstuurde facturen worden geprobeerd te
 * verwijderen — faalt dat, dan loggen we (handmatig credit/verwijderen in Moneybird).
 */
export async function deleteSalesInvoiceForShopifyOrderId(
  shopifyOrderId: string
): Promise<{ deleted: boolean; invoiceId?: string; error?: string }> {
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

  try {
    await moneybirdFetch<unknown>(`/sales_invoices/${existing.id}.json`, {
      method: "DELETE",
    });
    console.info("[moneybird] factuur verwijderd", existing.id, "voor", reference);
    return { deleted: true, invoiceId: existing.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[moneybird] factuur verwijderen mislukt", existing.id, msg);
    return { deleted: false, invoiceId: existing.id, error: msg };
  }
}

/**
 * Maakt een sales invoice in Moneybird voor een Shopify-order.
 * Reference = shopify:{id} zodat de Moneybird-webhook dubbele voorraadaftrek kan skippen.
 *
 * Orders onder €498: factuur wordt direct verstuurd per e-mail (status open).
 * Orders vanaf €498: blijven draft (handmatig controleren/versturen).
 * Testorders met "malyar" in de note: altijd draft, ongeacht prijs.
 * Totaal €0: geen factuur.
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
  const lock = await acquireMoneybirdShopifyInvoiceLock(supabase, shopifyOrderId);
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
    console.warn(
      "[moneybird] invoice lock bestaat maar geen factuur gevonden voor",
      reference,
      "— skip create"
    );
    return null;
  }

  const lockHeld = lock === "acquired";
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

    const details = buildInvoiceDetailsFromShopifyOrder(order);
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

    const isMalyarTest = isMalyarTestOrderNote(order.note);
    const shouldFinalize =
      !isMalyarTest &&
      Number.isFinite(totalIncl) &&
      totalIncl > 0 &&
      totalIncl < AUTO_FINALIZE_INVOICE_BELOW_EUR;

    if (shouldFinalize && created.id) {
      try {
        const email =
          String(order.email ?? order.contact_email ?? order.customer?.email ?? "")
            .trim() || undefined;
        created = await moneybirdFetch<MoneybirdSalesInvoice>(
          `/sales_invoices/${created.id}/send_invoice.json`,
          {
            method: "PATCH",
            body: JSON.stringify({
              sales_invoice_sending: {
                delivery_method: "Email",
                ...(email ? { email_address: email } : {}),
              },
            }),
          }
        );
        console.info(
          "[moneybird] factuur verstuurd per e-mail",
          created.id,
          "voor Shopify",
          orderName,
          `(totaal €${totalIncl.toFixed(2)} < ${AUTO_FINALIZE_INVOICE_BELOW_EUR})`,
          email ? `→ ${email}` : ""
        );
      } catch (sendErr) {
        console.error(
          "[moneybird] send_invoice mislukt — factuur blijft draft",
          created.id,
          sendErr
        );
      }
    } else {
      console.info(
        "[moneybird] draft factuur aangemaakt",
        created.id,
        "voor Shopify",
        orderName,
        Number.isFinite(totalIncl) ? `(totaal €${totalIncl.toFixed(2)})` : "",
        isMalyarTest ? "(malyar-test → altijd draft)" : ""
      );
    }

    return created;
  } finally {
    if (created?.id) {
      if (lockHeld) {
        await storeMoneybirdShopifyInvoiceId(supabase, shopifyOrderId, created.id);
      }
    } else if (lockHeld) {
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

function firstVariantPrice(product: ShopifyAdminProduct): string {
  const raw = product.variants?.[0]?.price;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return n.toFixed(2);
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
    return { action: removed ? "removed" : "skipped" };
  }

  const identifier = shopifyProductIdentifier(shopifyProductId);
  const description = String(product.title ?? "").trim() || `Shopify ${identifier}`;
  const taxRateId = process.env.MONEYBIRD_TAX_RATE_ID!.trim();
  const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();
  const payload = {
    product: {
      identifier,
      description,
      price: firstVariantPrice(product),
      currency: "EUR",
      tax_rate_id: taxRateId,
      ledger_account_id: ledgerAccountId,
    },
  };

  const existing = await findProductByIdentifier(identifier);
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
): Promise<boolean> {
  if (!isMoneybirdConfigured()) return false;

  const identifier = shopifyProductIdentifier(shopifyProductId);
  if (!identifier) return false;

  const existing = await findProductByIdentifier(identifier);
  if (!existing?.id) return false;

  try {
    await moneybirdFetch<unknown>(`/products/${existing.id}.json`, { method: "DELETE" });
    console.info("[moneybird] product verwijderd/gedeactiveerd", existing.id, identifier);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Moneybird 404")) return false;
    throw err;
  }
}
