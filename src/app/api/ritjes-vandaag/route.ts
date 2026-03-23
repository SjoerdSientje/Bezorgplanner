import { NextResponse } from "next/server";
import { fetchAllOrders } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allOrders = await fetchAllOrders();
    const orders = allOrders
      .filter((o) => o.status === "ritjes_vandaag")
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at as string).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at as string).getTime() : 0;
        return tb - ta; // nieuwste bovenaan
      });

    console.log("[ritjes-vandaag] totaal:", allOrders.length, "ritjes:", orders.length);

    return NextResponse.json(
      { orders },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[ritjes-vandaag]", e);
    return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
  }
}
