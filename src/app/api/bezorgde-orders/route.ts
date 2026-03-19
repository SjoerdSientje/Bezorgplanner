import { NextResponse } from "next/server";
import { fetchAllOrders } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allOrders = await fetchAllOrders();
    const orders = allOrders.filter(
      (o) => o.source === "shopify" && o.status === "bezorgd"
    );

    return NextResponse.json(
      { orders },
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

