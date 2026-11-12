import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { repairCompletedOrdersWithWrongStatus } from "@/lib/order-completion";
import { backfillBezorgdeOrderFacturen } from "@/lib/order-factuur";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    await repairCompletedOrdersWithWrongStatus(supabase, ownerEmail);

    // Best-effort: vul ontbrekende Moneybird-factuur-PDF's bij (sinds 1 okt).
    let factuurBackfill: Awaited<ReturnType<typeof backfillBezorgdeOrderFacturen>> | null =
      null;
    try {
      factuurBackfill = await backfillBezorgdeOrderFacturen(supabase, ownerEmail, {
        limit: 4,
      });
    } catch (e) {
      console.error("[api/bezorgde-orders] factuur backfill:", e);
    }

    // Shopify + afgeronde reparaties (factuur/ophalen → status bezorgd).
    // Contante reparaties gaan naar mp_orders en horen hier niet.
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .in("source", ["shopify", "reparatie"])
      .eq("status", "bezorgd")
      .order("afgerond_at", { ascending: false, nullsFirst: false })
      .range(0, 9999);
    if (error) {
      console.error("[api/bezorgde-orders] query", error);
      return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
    }

    return NextResponse.json(
      { orders: orders ?? [], factuurBackfill },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/bezorgde-orders]", e);
    return NextResponse.json(
      { error: "Ophalen mislukt." },
      { status: 500 }
    );
  }
}
