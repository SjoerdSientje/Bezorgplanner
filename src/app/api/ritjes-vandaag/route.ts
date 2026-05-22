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
    const { data: planningSlots, error: planningErr } = await supabase
      .from("planning_slots")
      .select("order_id, datum")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond");
    if (planningErr) {
      console.error("[ritjes-vandaag planning-slots]", planningErr);
      return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
    }

    const slotDatumByOrderId = new Map<string, string>();
    for (const s of planningSlots ?? []) {
      const id = String((s as Record<string, unknown>).order_id ?? "").trim();
      const d = String((s as Record<string, unknown>).datum ?? "").trim();
      if (!id || !d) continue;
      const prev = slotDatumByOrderId.get(id);
      if (!prev || d < prev) slotDatumByOrderId.set(id, d);
    }

    const orders = sortRitjesOrdersNewestFirst(
      (data ?? []).map((o) => {
        const id = String((o as Record<string, unknown>).id ?? "").trim();
        return {
          ...o,
          in_morgen_tab: slotDatumByOrderId.has(id),
          planning_slot_datum: slotDatumByOrderId.get(id) ?? null,
        };
      })
    );

    return NextResponse.json(
      { orders },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[ritjes-vandaag]", e);
    return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
  }
}
