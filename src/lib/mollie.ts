/**
 * Mollie Payments API — nodig omdat de Shopify Mollie-app géén tr_… in
 * order-transactions zet (alleen een Shopify payment-id r…).
 * Moneybird↔Mollie-aflettering vereist payment[transaction_identifier]=tr_…
 */

export type MolliePaymentMatch = {
  molliePaymentId: string;
  amount: number;
  status: string;
  description: string | null;
  createdAt: string | null;
  paidAt: string | null;
  metadata: Record<string, unknown> | null;
};

function mollieApiKey(): string | null {
  const key = process.env.MOLLIE_API_KEY?.trim() || "";
  return key || null;
}

export function isMollieApiConfigured(): boolean {
  return Boolean(mollieApiKey());
}

async function mollieFetch<T>(path: string): Promise<T> {
  const key = mollieApiKey();
  if (!key) throw new Error("MOLLIE_API_KEY ontbreekt.");
  const url = path.startsWith("http")
    ? path
    : `https://api.mollie.com/v2${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Mollie API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

type MollieListPayment = {
  id?: string;
  status?: string;
  description?: string | null;
  createdAt?: string | null;
  paidAt?: string | null;
  amount?: { value?: string; currency?: string } | null;
  metadata?: Record<string, unknown> | null;
};

type MollieListResponse = {
  _embedded?: { payments?: MollieListPayment[] };
  _links?: { next?: { href?: string | null } | null };
};

function parseAmount(value: string | null | undefined): number {
  const n = parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function orderNameVariants(orderName: string): string[] {
  const raw = String(orderName ?? "").trim();
  if (!raw) return [];
  const withHash = raw.startsWith("#") ? raw : `#${raw.replace(/^#/, "")}`;
  const noHash = withHash.replace(/^#/, "");
  return Array.from(new Set([raw, withHash, noHash, `Order ${withHash}`, `Order ${noHash}`]));
}

function paymentMatchesOrder(
  payment: MollieListPayment,
  opts: {
    shopifyOrderId: string;
    orderName?: string | null;
    amount?: number | null;
  }
): boolean {
  const shopifyOrderId = String(opts.shopifyOrderId ?? "").trim();
  const meta = payment.metadata ?? {};
  const metaBlob = normalizeText(JSON.stringify(meta));
  if (shopifyOrderId && metaBlob.includes(shopifyOrderId)) return true;

  const metaOrder =
    meta.shopify_order_id ??
    meta.shopifyOrderId ??
    meta.order_id ??
    meta.orderId ??
    meta.order_number ??
    meta.orderNumber;
  if (metaOrder != null && String(metaOrder).trim() === shopifyOrderId) return true;

  const desc = normalizeText(String(payment.description ?? ""));
  const variants = orderNameVariants(String(opts.orderName ?? ""));
  for (const v of variants) {
    const nv = normalizeText(v);
    if (nv.length >= 2 && desc.includes(nv)) return true;
  }

  // Alleen bedrag is te zwak als enige match — alleen als description ook "shopify" hint.
  return false;
}

function toMatch(payment: MollieListPayment): MolliePaymentMatch | null {
  const id = String(payment.id ?? "").trim();
  if (!/^tr_[A-Za-z0-9]+$/.test(id)) return null;
  return {
    molliePaymentId: id,
    amount: parseAmount(payment.amount?.value),
    status: String(payment.status ?? ""),
    description: payment.description != null ? String(payment.description) : null,
    createdAt: payment.createdAt != null ? String(payment.createdAt) : null,
    paidAt: payment.paidAt != null ? String(payment.paidAt) : null,
    metadata: payment.metadata ?? null,
  };
}

/**
 * Zoek Mollie-payment (tr_…) bij een Shopify-order.
 * Shopify Mollie-app zet tr_ niet in transactions → list + match op metadata/description.
 */
export async function findMolliePaymentForShopifyOrder(opts: {
  shopifyOrderId: string;
  orderName?: string | null;
  amount?: number | null;
  /** ISO timestamp rond betaling; beperkt hoe ver we terugzoeken. */
  aroundIso?: string | null;
  maxPages?: number;
}): Promise<MolliePaymentMatch | null> {
  if (!isMollieApiConfigured()) return null;

  const shopifyOrderId = String(opts.shopifyOrderId ?? "").trim();
  if (!shopifyOrderId) return null;

  const maxPages = Math.min(10, Math.max(1, opts.maxPages ?? 4));
  const aroundMs = opts.aroundIso ? Date.parse(opts.aroundIso) : NaN;
  const windowMs = 14 * 24 * 60 * 60 * 1000; // 14 dagen

  let nextPath: string | null = `/payments?limit=250`;
  const candidates: MolliePaymentMatch[] = [];

  for (let page = 0; page < maxPages && nextPath; page++) {
    const data: MollieListResponse = await mollieFetch<MollieListResponse>(nextPath);
    const payments: MollieListPayment[] = data._embedded?.payments ?? [];
    if (payments.length === 0) break;

    for (const p of payments) {
      const status = String(p.status ?? "").toLowerCase();
      if (status && status !== "paid" && status !== "authorized") continue;

      if (Number.isFinite(aroundMs)) {
        const created = p.createdAt ? Date.parse(p.createdAt) : NaN;
        const paid = p.paidAt ? Date.parse(p.paidAt) : NaN;
        const t = Number.isFinite(paid) ? paid : created;
        if (Number.isFinite(t) && Math.abs(t - aroundMs) > windowMs) continue;
      }

      if (!paymentMatchesOrder(p, opts)) continue;
      const match = toMatch(p);
      if (match) candidates.push(match);
    }

    // Stop early als we voorbij het tijdvenster zijn (lijst is newest→oldest).
    if (Number.isFinite(aroundMs) && payments.length > 0) {
      const oldest = payments[payments.length - 1];
      const oldestMs = oldest?.createdAt ? Date.parse(oldest.createdAt) : NaN;
      if (Number.isFinite(oldestMs) && oldestMs < aroundMs - windowMs) break;
    }

    const nextHref: string | null | undefined = data._links?.next?.href;
    nextPath = nextHref
      ? nextHref.replace("https://api.mollie.com/v2", "")
      : null;
  }

  if (candidates.length === 0) return null;

  const targetAmount =
    opts.amount != null && Number.isFinite(Number(opts.amount))
      ? Number(opts.amount)
      : null;

  candidates.sort((a, b) => {
    if (targetAmount != null) {
      const da = Math.abs(a.amount - targetAmount);
      const db = Math.abs(b.amount - targetAmount);
      if (da !== db) return da - db;
    }
    const ta = a.paidAt || a.createdAt || "";
    const tb = b.paidAt || b.createdAt || "";
    return tb.localeCompare(ta);
  });

  return candidates[0] ?? null;
}
