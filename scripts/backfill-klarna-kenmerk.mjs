/**
 * Zet Moneybird-kenmerk van Klarna Shopify-hoofdfacturen om naar Shopify Payment ID.
 *
 * Dry-run (default): toont wat er zou wijzigen.
 * Apply:  node scripts/backfill-klarna-kenmerk.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1].trim();
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const APPLY = process.argv.includes("--apply");
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2025-01";

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const shopDomain = requireEnv("SHOPIFY_SHOP_DOMAIN")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const shopifyClientId = requireEnv("SHOPIFY_CLIENT_ID");
const shopifyClientSecret = requireEnv("SHOPIFY_CLIENT_SECRET");
const mbAdmin = requireEnv("MONEYBIRD_ADMINISTRATION_ID");
const mbToken = requireEnv("MONEYBIRD_API_TOKEN");

const sb = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

let shopifyToken = null;
let shopifyTokenExpires = 0;

async function getShopifyToken() {
  if (shopifyToken && Date.now() < shopifyTokenExpires - 60_000) return shopifyToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: shopifyClientId,
    client_secret: shopifyClientSecret,
  });
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify token ${res.status}: ${text}`);
  const data = JSON.parse(text);
  shopifyToken = data.access_token;
  const expiresIn = Number(data.expires_in) || 86400;
  shopifyTokenExpires = Date.now() + expiresIn * 1000;
  return shopifyToken;
}

async function shopifyJson(path) {
  const token = await getShopifyToken();
  const res = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`,
    {
      headers: {
        "X-Shopify-Access-Token": token,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify ${res.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function moneybirdJson(path, init = {}, attempt = 0) {
  const res = await fetch(`https://moneybird.com/api/v2/${mbAdmin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${mbToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (res.status === 429 && attempt < 6) {
    const wait = 1500 * (attempt + 1);
    console.warn(`Moneybird 429 — retry over ${wait}ms (${path})`);
    await sleep(wait);
    return moneybirdJson(path, init, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(
      `Moneybird ${res.status} ${path}: ${typeof body === "object" ? JSON.stringify(body) : body}`
    );
  }
  return body;
}

function collectStringsDeep(value, out, depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringsDeep(item, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectStringsDeep(v, out, depth + 1);
  }
}

function extractKlarnaPaymentId(tx) {
  const receipt =
    tx.receipt && typeof tx.receipt === "object" ? tx.receipt : null;
  const paymentDetails =
    tx.payment_details && typeof tx.payment_details === "object"
      ? tx.payment_details
      : null;
  const preferred = [
    receipt?.payment_id,
    receipt?.paymentId,
    receipt?.PaymentId,
    paymentDetails?.payment_id,
    tx.payment_id,
  ];
  for (const raw of preferred) {
    const s = String(raw ?? "").trim();
    if (!s || /^tr_/i.test(s) || /^shopify:/i.test(s)) continue;
    if (s.length >= 8) return s;
  }
  const blobs = [];
  collectStringsDeep(tx.receipt, blobs);
  collectStringsDeep(tx.payment_details, blobs);
  for (const s of blobs) {
    const t = String(s).trim();
    if (!t || /^tr_/i.test(t) || /^shopify:/i.test(t)) continue;
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ||
      /^[0-9a-f]{16,}$/i.test(t) ||
      /^[A-Za-z0-9_-]{12,}$/.test(t)
    ) {
      return t;
    }
  }
  return null;
}

async function fetchKlarnaPaymentId(orderId) {
  const data = await shopifyJson(`/orders/${orderId}/transactions.json`);
  const txs = Array.isArray(data?.transactions) ? data.transactions : [];
  const candidates = [];
  for (const tx of txs) {
    const gateway = String(tx.gateway ?? "").toLowerCase();
    if (!gateway.includes("klarna")) continue;
    const status = String(tx.status ?? "").toLowerCase();
    if (status && status !== "success" && status !== "pending") continue;
    const kind = String(tx.kind ?? "").toLowerCase();
    if (kind && !["sale", "capture", "authorization"].includes(kind)) continue;
    const paymentId = extractKlarnaPaymentId(tx);
    if (!paymentId) continue;
    const amountRaw =
      typeof tx.amount === "number"
        ? tx.amount
        : parseFloat(String(tx.amount ?? "0").replace(",", "."));
    candidates.push({
      paymentId,
      amount: Number.isFinite(amountRaw) ? amountRaw : 0,
      kind,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const rank = (k) => (k === "sale" || k === "capture" ? 2 : 1);
    const d = rank(b.kind) - rank(a.kind);
    return d !== 0 ? d : b.amount - a.amount;
  });
  return candidates[0].paymentId;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(APPLY ? "MODE: apply" : "MODE: dry-run (pass --apply to write)");

  const { data: locks, error } = await sb
    .from("moneybird_shopify_invoice_locks")
    .select("shopify_order_id, moneybird_invoice_id")
    .not("moneybird_invoice_id", "is", null);

  if (error) throw new Error(`locks query: ${error.message}`);

  const rows = locks ?? [];
  console.log(`Locks met factuur: ${rows.length}`);

  let klarna = 0;
  let updated = 0;
  let skipped = 0;
  let missingPaymentId = 0;
  let errors = 0;

  for (const row of rows) {
    const orderId = String(row.shopify_order_id ?? "").trim();
    const invoiceId = String(row.moneybird_invoice_id ?? "").trim();
    if (!orderId || !invoiceId) continue;

    try {
      const paymentId = await fetchKlarnaPaymentId(orderId);
      if (!paymentId) {
        skipped += 1;
        await sleep(80);
        continue;
      }
      klarna += 1;

      let invoice = null;
      let resolvedInvoiceId = invoiceId;
      try {
        invoice = await moneybirdJson(`/sales_invoices/${invoiceId}.json`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Moneybird 404")) throw err;
        // Lock wijst naar verwijderde factuur → zoek via klassiek kenmerk.
        try {
          const enc = encodeURIComponent(`shopify:${orderId}`);
          invoice = await moneybirdJson(
            `/sales_invoices/find_by_reference/${enc}.json`
          );
          resolvedInvoiceId = String(invoice?.id ?? "").trim();
          if (resolvedInvoiceId && APPLY) {
            await sb
              .from("moneybird_shopify_invoice_locks")
              .update({ moneybird_invoice_id: resolvedInvoiceId })
              .eq("shopify_order_id", orderId);
          }
          console.log(
            `RECOVERED ${orderId} via shopify:${orderId} → invoice=${resolvedInvoiceId}`
          );
        } catch (err2) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          if (msg2.includes("Moneybird 404")) {
            console.log(`SKIP gone ${orderId} (lock invoice 404, geen shopify:ref)`);
            skipped += 1;
            await sleep(250);
            continue;
          }
          throw err2;
        }
      }

      if (!invoice?.id) {
        skipped += 1;
        continue;
      }
      resolvedInvoiceId = String(invoice.id);

      const current = String(invoice?.reference ?? "").trim();
      if (/^shopify:\d+:/i.test(current)) {
        console.log(`SKIP derived ${orderId} invoice=${resolvedInvoiceId} ref=${current}`);
        skipped += 1;
        await sleep(250);
        continue;
      }
      if (current === paymentId) {
        console.log(`OK already ${orderId} → ${paymentId}`);
        skipped += 1;
        await sleep(250);
        continue;
      }

      console.log(
        `${APPLY ? "UPDATE" : "WOULD"} ${orderId} invoice=${resolvedInvoiceId} "${current}" → "${paymentId}"`
      );
      if (APPLY) {
        await moneybirdJson(`/sales_invoices/${resolvedInvoiceId}.json`, {
          method: "PATCH",
          body: JSON.stringify({ sales_invoice: { reference: paymentId } }),
        });
        updated += 1;
      } else {
        updated += 1;
      }
      await sleep(450);
    } catch (err) {
      errors += 1;
      console.error(
        `ERR order=${orderId} invoice=${invoiceId}:`,
        err instanceof Error ? err.message : err
      );
      await sleep(800);
    }
  }

  console.log(
    JSON.stringify(
      {
        klarna,
        wouldOrDidUpdate: updated,
        skipped,
        missingPaymentId,
        errors,
        applied: APPLY,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
