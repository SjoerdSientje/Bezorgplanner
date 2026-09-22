import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { syncPakketjesForOwner } from "@/lib/pakketjes-sync";
import { PAKKETJES_MAX_PRIJS } from "@/lib/shopify-order";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  shopify_created_at: string | null;
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
    const sync = request.nextUrl.searchParams.get("sync") !== "0";

    let syncMeta: { upserted: number; removed: number; scanned: number } | null = null;
    if (sync) {
  try {
        syncMeta = await syncPakketjesForOwner(supabase, ownerEmail);
      } catch (syncErr) {
        const msg = syncErr instanceof Error ? syncErr.message : "Shopify-sync mislukt.";
        // Zonder read_orders-scope kan Admin API niet syncen; toon dan gewoon de DB-lijst.
        const scopeMissing =
          /read_orders/i.test(msg) ||
          /403/.test(msg) ||
          /merchant approval/i.test(msg);
        if (!scopeMissing) {
          console.error("[paklijst/pakketjes] sync:", syncErr);
          return NextResponse.json(
            { error: `Shopify-sync mislukt: ${msg}` },
            { status: 502, headers: { "Cache-Control": "no-store" } }
          );
        }
        console.warn("[paklijst/pakketjes] sync overgeslagen (geen read_orders):", msg);
        syncMeta = { upserted: 0, removed: 0, scanned: 0 };
      }
    }

    let { data: rows, error } = await supabase
      .from("pakketjes_orders")
      .select(
        "id, shopify_order_id, order_nummer, naam, adres, items, totaal_prijs, fulfillment_status, created_at, shopify_created_at"
      )
      .eq("owner_email", ownerEmail)
      .order("created_at", { ascending: true });

    if (error?.message?.includes("shopify_created_at")) {
      const fallback = await supabase
        .from("pakketjes_orders")
        .select(
          "id, shopify_order_id, order_nummer, naam, adres, items, totaal_prijs, fulfillment_status, created_at"
        )
        .eq("owner_email", ownerEmail)
        .order("created_at", { ascending: true });
      rows = (fallback.data ?? []).map((r) => ({ ...r, shopify_created_at: null }));
      error = fallback.error;
    }

    if (error) {
      throw new Error(error.message);
    }

    const list = (rows ?? []) as PakketjesRow[];
    // Null shopify_created_at onderaan / op created_at sorteren.
    list.sort((a, b) => {
      const ta = Date.parse(String(a.shopify_created_at ?? a.created_at ?? 0));
      const tb = Date.parse(String(b.shopify_created_at ?? b.created_at ?? 0));
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });

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
        shopify_created_at: r.shopify_created_at ?? r.created_at ?? null,
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
        maxPrijs: PAKKETJES_MAX_PRIJS,
        sync: syncMeta,
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
