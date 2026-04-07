import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail, shopifyWebhookOrderAppliesToOwner } from "@/lib/account";

export const dynamic = "force-dynamic";

type ShopifyAddress = {
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
};

type ShopifyLineItem = {
  name?: string | null;
  quantity?: number | null;
};

type ShopifyOrder = {
  id?: number | string;
  name?: string | null;
  note?: string | null;
  total_price?: string | number | null;
  fulfillment_status?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[] | null;
};

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function parseMoney(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fullName(order: ShopifyOrder): string {
  const fn = String(order.customer?.first_name ?? "").trim();
  const ln = String(order.customer?.last_name ?? "").trim();
  return [fn, ln].filter(Boolean).join(" ").trim();
}

function fullAddress(order: ShopifyOrder): string {
  const a = order.shipping_address ?? order.billing_address ?? {};
  return [a.address1, a.address2, a.zip, a.city]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(",");
  for (const p of parts) {
    const section = p.trim();
    if (!section.includes('rel="next"')) continue;
    const m = section.match(/<([^>]+)>/);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function fetchAllOpenOrdersFromShopify(): Promise<ShopifyOrder[]> {
  const shop = env("SHOPIFY_STORE_DOMAIN");
  const token = env("SHOPIFY_ADMIN_API_ACCESS_TOKEN");
  const version = env("SHOPIFY_API_VERSION") || "2024-10";
  if (!shop || !token) {
    throw new Error("SHOPIFY_STORE_DOMAIN of SHOPIFY_ADMIN_API_ACCESS_TOKEN ontbreekt.");
  }

  const orders: ShopifyOrder[] = [];
  let nextUrl: string | null =
    `https://${shop}/admin/api/${version}/orders.json` +
    `?status=open&fulfillment_status=unfulfilled&limit=250&fields=id,name,note,total_price,fulfillment_status,customer,shipping_address,billing_address,line_items`;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.errors ? JSON.stringify(json.errors) : `Shopify fout (${res.status})`);
    }
    const batch = Array.isArray(json?.orders) ? (json.orders as ShopifyOrder[]) : [];
    orders.push(...batch);
    nextUrl = parseLinkHeader(res.headers.get("link"));
  }

  return orders;
}

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const allOpenOrders = await fetchAllOpenOrdersFromShopify();

    const selected = allOpenOrders.filter((o) => {
      if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, o.note)) return false;
      const total = parseMoney(o.total_price);
      return total > 0 && total < 500;
    });

    const orders = selected.map((o) => {
      const items = (o.line_items ?? [])
        .flatMap((li) => {
          const name = String(li.name ?? "").trim();
          if (!name) return [];
          const qty = Math.max(1, Number(li.quantity ?? 1) || 1);
          return [{ name, quantity: qty }];
        });
      return {
        id: String(o.id ?? ""),
        order_nummer: String(o.name ?? ""),
        naam: fullName(o),
        adres: fullAddress(o),
        totaal_prijs: parseMoney(o.total_price),
        fulfillment_status: String(o.fulfillment_status ?? ""),
        items,
      };
    });

    const counts = new Map<string, number>();
    for (const o of orders) {
      for (const it of o.items) {
        counts.set(it.name, (counts.get(it.name) ?? 0) + it.quantity);
      }
    }
    const summary = Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, "nl"))
      .map(([name, count]) => ({ name, count }));

    return NextResponse.json(
      {
        orders,
        summary,
        count: orders.length,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Pakketjes paklijst genereren mislukt." },
      { status: 500 }
    );
  }
}

