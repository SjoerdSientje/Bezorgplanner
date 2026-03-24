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

    // Source = intersection of:
    // - orders visible in current planning section
    // - orders visible in Ritjes voor vandaag (status = ritjes_vandaag)
    const { data: slots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("id, datum, order_id, volgorde, aankomsttijd")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond")
      .order("datum", { ascending: true })
      .order("volgorde", { ascending: true });
    if (slotsErr) {
      return NextResponse.json({ error: "Planning ophalen mislukt." }, { status: 500 });
    }

    const slotList = slots ?? [];
    if (slotList.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    const orderIds = slotList.map((s: { order_id: string }) => s.order_id);
    const { data: ordersData, error: ordersErr } = await supabase
      .from("orders")
      .select("id, order_nummer, naam, aankomsttijd_slot, telefoon_e164, telefoon_nummer, bezorgtijd_voorkeur, status")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .in("id", orderIds);
    if (ordersErr) {
      return NextResponse.json({ error: "Orders ophalen mislukt." }, { status: 500 });
    }

    const ordersById = new Map(
      (ordersData ?? []).map((o: Record<string, unknown>) => [String(o.id), o])
    );

    const allRows = slotList
      .map((slot: Record<string, unknown>) => {
        const o = ordersById.get(String(slot.order_id)) ?? null;
        if (!o) return null;
        const slotTijd = String(slot.aankomsttijd ?? "").trim();
        const orderTijd = String((o as Record<string, unknown>).aankomsttijd_slot ?? "").trim();
        // Must have a timeslot in both planning and ritjes.
        if (!slotTijd || !orderTijd) return null;
        return {
          slot_id: String(slot.id ?? ""),
          order_id: String(slot.order_id ?? ""),
          datum: String((slot as Record<string, unknown>).datum ?? ""),
          volgorde: Number(slot.volgorde ?? 0),
          order_nummer: String((o as Record<string, unknown>).order_nummer ?? ""),
          naam: String((o as Record<string, unknown>).naam ?? ""),
          aankomsttijd_slot: orderTijd,
          telefoon_e164: String((o as Record<string, unknown>).telefoon_e164 ?? ""),
          telefoon_nummer: String((o as Record<string, unknown>).telefoon_nummer ?? ""),
          bezorgtijd_voorkeur: String((o as Record<string, unknown>).bezorgtijd_voorkeur ?? ""),
        };
      })
      .filter((r) => r != null);

    // Match Planning page behavior: first (earliest) date is the current section.
    const activeDate = allRows.length > 0 ? String(allRows[0].datum ?? "") : "";
    const rows = activeDate
      ? allRows.filter((r) => String((r as Record<string, unknown>).datum ?? "") === activeDate)
      : allRows;

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
