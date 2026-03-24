import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { sortRitjesOrdersNewestFirst } from "@/lib/ritjes-mapping";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag");
    if (error) {
      console.error("[ritjes-vandaag]", error);
      return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
    }
    const orders = sortRitjesOrdersNewestFirst(data ?? []);

    return NextResponse.json(
      { orders },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[ritjes-vandaag]", e);
    return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
  }
}
