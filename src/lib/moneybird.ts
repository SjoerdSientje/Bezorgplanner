/**
 * Moneybird API-client (sales invoices + webhook signature).
 * @see https://developer.moneybird.com/
 */

import { createHmac, timingSafeEqual } from "crypto";
import { isMalyarTestOrderNote } from "@/lib/account";
import type { ShopifyLineItem, ShopifyOrder } from "@/lib/shopify-order";
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
    if (msg.includes("Moneybird 404")) return null;
    throw err;
  }
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

/** Ordertotaal incl. BTW — total_price, current_total_price of som van regels. */
export function shopifyOrderBillableTotalIncl(order: ShopifyOrder): number {
  const fromTotal = parseMoneyAmount(order.total_price);
  const fromCurrent = parseMoneyAmount(order.current_total_price);
  const lineSum = (order.line_items ?? []).reduce(
    (sum, li) => sum + lineItemNetTotalIncl(li),
    0
  );

  if (Number.isFinite(fromTotal)) return Math.max(0, fromTotal);
  if (Number.isFinite(fromCurrent)) return Math.max(0, fromCurrent);
  return lineSum;
}

function isZeroInvoiceTotal(totalIncl: number): boolean {
  return !Number.isFinite(totalIncl) || totalIncl < 0.01;
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
  const existing = await findSalesInvoiceByReference(reference);
  if (existing) {
    console.info(
      "[moneybird] factuur bestaat al voor",
      reference,
      "— skip create",
      existing.id
    );
    return existing;
  }

  const taxRateId = process.env.MONEYBIRD_TAX_RATE_ID!.trim();
  const ledgerAccountId = process.env.MONEYBIRD_LEDGER_ACCOUNT_ID!.trim();

  const contact = await findOrCreateContactForShopifyOrder(order);
  const orderName = String(order.name ?? shopifyOrderId).trim();

  const details = (order.line_items ?? [])
    .map((li) => {
      const description = String(li.name ?? "").trim() || "Product";
      const amount = Math.max(1, Math.floor(Number(li.quantity ?? 1)));
      return {
        description: `${description} (${orderName})`,
        price: unitPriceExclApprox(li.price),
        amount: String(amount),
        tax_rate_id: taxRateId,
        ledger_account_id: ledgerAccountId,
      };
    })
    .filter((d) => d.description);

  if (details.length === 0) {
    console.warn("[moneybird] geen line items voor order", shopifyOrderId);
    return null;
  }

  const detailsTotalExcl = details.reduce(
    (sum, d) => sum + (parseFloat(d.price) || 0) * (parseFloat(d.amount) || 0),
    0
  );
  if (detailsTotalExcl < 0.01) {
    console.info(
      "[moneybird] factuurregels totaal €0 — geen factuur",
      shopifyOrderId,
      order.name ?? ""
    );
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

  let created = await moneybirdFetch<MoneybirdSalesInvoice>("/sales_invoices.json", {
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
