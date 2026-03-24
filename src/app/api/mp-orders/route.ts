import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("source", "mp")
      .neq("status", "ritjes_vandaag");
    if (error) {
      console.error("[mp-orders]", error);
      return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
    }

    return NextResponse.json(
      { orders: orders ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[mp-orders]", e);
    return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
  }
}
