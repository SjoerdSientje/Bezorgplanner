import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

type PakketjesItem = { name: string; quantity: number };

type PakketjesRow = {
  id: string;
  shopify_order_id: string;
  order_nummer: string | null;
  naam: string | null;
  adres: string | null;
  items: unknown;
  totaal_prijs: number;
  fulfillment_status: string | null;
  created_at: string;
};

function normalizeItems(raw: unknown): PakketjesItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PakketjesItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const quantity = Math.max(1, Number(o.quantity ?? 1) || 1);
    out.push({ name, quantity });
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();

    const { data: rows, error } = await supabase
      .from("pakketjes_orders")
      .select(
        "id, shopify_order_id, order_nummer, naam, adres, items, totaal_prijs, fulfillment_status, created_at"
      )
      .eq("owner_email", ownerEmail)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const list = (rows ?? []) as PakketjesRow[];
    const orders = list.map((r) => {
      const items = normalizeItems(r.items);
      return {
        id: r.id,
        shopify_order_id: r.shopify_order_id,
        order_nummer: String(r.order_nummer ?? ""),
        naam: String(r.naam ?? ""),
        adres: String(r.adres ?? ""),
        totaal_prijs: Number(r.totaal_prijs ?? 0),
        fulfillment_status: r.fulfillment_status ?? "",
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
      { error: e instanceof Error ? e.message : "Pakketjes laden mislukt." },
      { status: 500 }
    );
  }
}
