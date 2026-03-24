import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

function shouldIncludeForStuurAppjes(order: {
  meenemen_in_planning?: boolean | null;
  nieuw_appje_sturen?: boolean | null;
}): boolean {
  if (order.meenemen_in_planning !== true) return false;
  if (order.nieuw_appje_sturen !== true) return false;
  return true;
}

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

    // 1) Start from what is currently visible in Planning:
    // active (not afgerond) slots with a filled planning timeslot.
    const { data: slots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("id, datum, order_id, volgorde, aankomsttijd")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond")
      .order("datum", { ascending: false })
      .order("volgorde", { ascending: true });
    if (slotsErr) {
      return NextResponse.json(
        { error: `Planning ophalen mislukt: ${slotsErr.message}` },
        { status: 500 }
      );
    }
    const slotList = slots ?? [];
    if (slotList.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    // 2) Keep first valid slot per order.
    // If an order has multiple slots, keep the first one from the sorted list
    // (latest date first, then lowest volgorde).
    const activeSlotMap = new Map<string, { slot_id: string; volgorde: number; slot_date: string }>();
    for (const s of slotList as Array<{
      order_id?: string | null;
      id?: string | null;
      volgorde?: number | null;
      datum?: string | null;
      aankomsttijd?: string | null;
    }>) {
      const orderId = String(s.order_id ?? "").trim();
      if (!orderId) continue;
      if (activeSlotMap.has(orderId)) continue;
      if (String(s.aankomsttijd ?? "").trim() === "") continue;
      activeSlotMap.set(orderId, {
        slot_id: String(s.id ?? ""),
        volgorde: Number(s.volgorde ?? 0),
        slot_date: String(s.datum ?? ""),
      });
    }
    if (activeSlotMap.size === 0) {
      return NextResponse.json({ orders: [] });
    }

    // 3) Intersect with Ritjes voor vandaag that currently has an order timeslot.
    const activeOrderIds = Array.from(activeSlotMap.keys());
    const { data: ritjesOrders, error: ordersErr } = await supabase
      .from("orders")
      .select("id, order_nummer, naam, aankomsttijd_slot, telefoon_e164, telefoon_nummer, bezorgtijd_voorkeur, meenemen_in_planning, nieuw_appje_sturen")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .in("id", activeOrderIds);
    if (ordersErr) {
      return NextResponse.json(
        { error: `Ritjes ophalen mislukt: ${ordersErr.message}` },
        { status: 500 }
      );
    }
    const ritjesWithSlot = (ritjesOrders ?? []).filter(
      (o: Record<string, unknown>) => String(o.aankomsttijd_slot ?? "").trim() !== ""
    );
    const ritjesById = new Map(ritjesWithSlot.map((o: Record<string, unknown>) => [String(o.id ?? ""), o]));

    const rows = Array.from(activeSlotMap.entries())
      .map(([orderId, slot]) => {
        const o = ritjesById.get(orderId);
        if (!o) return null;
        const ritjesTijd = String((o as Record<string, unknown>).aankomsttijd_slot ?? "").trim();
        // Must have a timeslot in ritjes too.
        if (!ritjesTijd) return null;
        if (
          !shouldIncludeForStuurAppjes(
            {
              meenemen_in_planning: (o as Record<string, unknown>).meenemen_in_planning as boolean | null | undefined,
              nieuw_appje_sturen: (o as Record<string, unknown>).nieuw_appje_sturen as boolean | null | undefined,
            }
          )
        ) {
          return null;
        }
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
