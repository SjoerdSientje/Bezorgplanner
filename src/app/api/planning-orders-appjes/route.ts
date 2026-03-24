import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

/**
 * GET /api/planning-orders-appjes
 * Returns all orders that are currently in the active planning (today's planning_slots),
 * together with their current aankomsttijd_slot and contact details for WhatsApp.
 * These are the orders the user can select to send an updated time slot message.
 */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: ritjesOrders, error: ordersErr } = await supabase
      .from("orders")
      .select("id, order_nummer, naam, aankomsttijd_slot, telefoon_e164, telefoon_nummer, bezorgtijd_voorkeur, created_at")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .order("created_at", { ascending: false });
    if (ordersErr) {
      return NextResponse.json(
        { error: `Ritjes ophalen mislukt: ${ordersErr.message}` },
        { status: 500 }
      );
    }

    const rows = (ritjesOrders ?? [])
      .filter(
      (o: Record<string, unknown>) => String(o.aankomsttijd_slot ?? "").trim() !== ""
    )
      .map((o: Record<string, unknown>, index: number) => {
        return {
          // slot_id is not used for selection anymore; keep API contract for frontend send payload.
          slot_id: "",
          order_id: String(o.id ?? ""),
          volgorde: index + 1,
          order_nummer: String(o.order_nummer ?? ""),
          naam: String(o.naam ?? ""),
          aankomsttijd_slot: String(o.aankomsttijd_slot ?? ""),
          telefoon_e164: String(o.telefoon_e164 ?? ""),
          telefoon_nummer: String(o.telefoon_nummer ?? ""),
          bezorgtijd_voorkeur: String(o.bezorgtijd_voorkeur ?? ""),
        };
      });

    return NextResponse.json(
      { orders: rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/planning-orders-appjes]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
