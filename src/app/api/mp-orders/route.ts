import { NextResponse } from "next/server";
import { fetchAllOrders } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allOrders = await fetchAllOrders();

    // Bezorging orders (status=ritjes_vandaag) horen pas in MP orders na afhandeling
    const orders = allOrders.filter(
      (o) => o.source === "mp" && o.status !== "ritjes_vandaag"
    );

    console.log("[mp-orders] totaal:", allOrders.length, "mp:", orders.length);

    return NextResponse.json(
      { orders },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[mp-orders]", e);
    return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
  }
}
