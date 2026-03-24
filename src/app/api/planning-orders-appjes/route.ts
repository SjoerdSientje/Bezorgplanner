import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";
import { getPlanningDateForGoedkeuren } from "@/lib/planning-date";

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

    // 1) Fetch Ritjes voor vandaag orders that already have a visible timeslot.
    const { data: ritjesOrders, error: ordersErr } = await supabase
      .from("orders")
      .select("id, order_nummer, naam, aankomsttijd_slot, telefoon_e164, telefoon_nummer, bezorgtijd_voorkeur")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag");
    if (ordersErr) {
      return NextResponse.json({ error: "Orders ophalen mislukt." }, { status: 500 });
    }
    const ritjesWithSlot = (ritjesOrders ?? []).filter(
      (o: Record<string, unknown>) => String(o.aankomsttijd_slot ?? "").trim() !== ""
    );
    if (ritjesWithSlot.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    // 2) Read planning slots only for those ritjes-orders.
    // Prefer the operation planning date (same logic as planning-goedkeuren),
    // but gracefully fallback to the most recent planning date that has slots.
    const { date: planningDate } = getPlanningDateForGoedkeuren();
    const ritjesOrderIds = ritjesWithSlot.map((o: Record<string, unknown>) => String(o.id ?? ""));
    const { data: slots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("id, datum, order_id, volgorde, aankomsttijd")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond")
      .in("order_id", ritjesOrderIds)
      .order("datum", { ascending: false })
      .order("volgorde", { ascending: true });
    if (slotsErr) {
      return NextResponse.json({ error: "Planning ophalen mislukt." }, { status: 500 });
    }
    const slotList = slots ?? [];
    if (slotList.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    // 3) Use planningDate if present; otherwise use the most recent available date.
    const preferredSlots = slotList.filter(
      (s: { datum?: string | null }) => String(s.datum ?? "") === planningDate
    );
    const fallbackDate = String(slotList[0]?.datum ?? "");
    const activeDate = preferredSlots.length > 0 ? planningDate : fallbackDate;
    const activeSlots = slotList.filter(
      (s: { datum?: string | null }) => String(s.datum ?? "") === activeDate
    );
    if (activeSlots.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    // Require non-empty planning slot timeslot too.
    const activeSlotMap = new Map(
      activeSlots
        .filter((s: { aankomsttijd?: string | null }) => String(s.aankomsttijd ?? "").trim() !== "")
        .map((s: { order_id: string; id: string; volgorde: number }) => [
          String(s.order_id),
          { slot_id: String(s.id), volgorde: Number(s.volgorde ?? 0) },
        ])
    );
    if (activeSlotMap.size === 0) {
      return NextResponse.json({ orders: [] });
    }

    const ritjesById = new Map(
      ritjesWithSlot.map((o: Record<string, unknown>) => [String(o.id ?? ""), o])
    );

    const rows = Array.from(activeSlotMap.entries())
      .map(([orderId, slot]) => {
        const o = ritjesById.get(orderId);
        if (!o) return null;
        const ritjesTijd = String((o as Record<string, unknown>).aankomsttijd_slot ?? "").trim();
        // Must have a timeslot in ritjes too.
        if (!ritjesTijd) return null;
        return {
          slot_id: slot?.slot_id ?? "",
          order_id: orderId,
          volgorde: slot?.volgorde ?? 0,
          order_nummer: String((o as Record<string, unknown>).order_nummer ?? ""),
          naam: String((o as Record<string, unknown>).naam ?? ""),
          aankomsttijd_slot: ritjesTijd,
          telefoon_e164: String((o as Record<string, unknown>).telefoon_e164 ?? ""),
          telefoon_nummer: String((o as Record<string, unknown>).telefoon_nummer ?? ""),
          bezorgtijd_voorkeur: String((o as Record<string, unknown>).bezorgtijd_voorkeur ?? ""),
        };
      })
      .filter((r) => r != null)
      .sort((a, b) => Number((a as Record<string, unknown>).volgorde ?? 0) - Number((b as Record<string, unknown>).volgorde ?? 0));

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
