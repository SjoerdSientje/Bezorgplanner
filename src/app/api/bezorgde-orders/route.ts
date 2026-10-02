import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { repairCompletedOrdersWithWrongStatus } from "@/lib/order-completion";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    await repairCompletedOrdersWithWrongStatus(supabase, ownerEmail);
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
      { orders: orders ?? [] },
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

