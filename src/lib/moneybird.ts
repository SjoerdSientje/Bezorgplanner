/**
 * Moneybird API-client (sales invoices + webhook signature).
 * @see https://developer.moneybird.com/
 */

import { createHmac, timingSafeEqual } from "crypto";
import { isMalyarTestOrderNote } from "@/lib/account";
import type { ShopifyOrder } from "@/lib/shopify-order";

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

/**
 * Maakt een sales invoice in Moneybird voor een Shopify-order.
 * Reference = shopify:{id} zodat de Moneybird-webhook dubbele voorraadaftrek kan skippen.
 *
 * Orders onder €498: factuur wordt direct verstuurd per e-mail (status open).
 * Orders vanaf €498: blijven draft (handmatig controleren/versturen).
 * Testorders met "malyar" in de note: altijd draft, ongeacht prijs.
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

  const payload = {
    sales_invoice: {
      contact_id: contact.id,
      reference: shopifyReferenceForOrderId(shopifyOrderId),
      currency: "EUR",
      prices_are_incl_tax: false,
      details_attributes: details,
    },
  };

  let created = await moneybirdFetch<MoneybirdSalesInvoice>("/sales_invoices.json", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const totalIncl = parseFloat(String(order.total_price ?? 0));
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
