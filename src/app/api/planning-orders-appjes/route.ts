import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/planning-orders-appjes
 * Returns all orders that are currently in the active planning (today's planning_slots),
 * together with their current aankomsttijd_slot and contact details for WhatsApp.
 * These are the orders the user can select to send an updated time slot message.
 */
export async function GET() {
  try {
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

    // Today in Amsterdam timezone
    const today = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" })
    );
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const todayStr = `${y}-${m}-${d}`;

    // Get today's planning slots
    const { data: slots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("id, order_id, volgorde, aankomsttijd")
      .eq("datum", todayStr)
      .order("volgorde", { ascending: true });

    if (slotsErr) {
      return NextResponse.json({ error: "Planning ophalen mislukt." }, { status: 500 });
    }
    if (!slots?.length) {
      return NextResponse.json({ orders: [] });
    }

    const orderIds = slots.map((s: { order_id: string }) => s.order_id);
    const { data: ordersData, error: ordersErr } = await supabase
      .from("orders")
      .select("*")
      .in("id", orderIds);

    if (ordersErr) {
      return NextResponse.json({ error: "Orders ophalen mislukt." }, { status: 500 });
    }

    const ordersById = new Map(
      (ordersData ?? []).map((o: Record<string, unknown>) => [o.id as string, o])
    );

    const result = slots.map((slot: Record<string, unknown>) => {
      const o = ordersById.get(slot.order_id as string) ?? {};
      return {
        slot_id: slot.id,
        order_id: slot.order_id,
        volgorde: slot.volgorde,
        order_nummer: (o as Record<string, unknown>).order_nummer ?? "",
        naam: (o as Record<string, unknown>).naam ?? "",
        // aankomsttijd_slot from orders table = most up-to-date (user may have manually updated it)
        aankomsttijd_slot: (o as Record<string, unknown>).aankomsttijd_slot ?? slot.aankomsttijd ?? "",
        telefoon_e164: (o as Record<string, unknown>).telefoon_e164 ?? "",
        telefoon_nummer: (o as Record<string, unknown>).telefoon_nummer ?? "",
        bezorgtijd_voorkeur: (o as Record<string, unknown>).bezorgtijd_voorkeur ?? "",
      };
    });

    return NextResponse.json({ orders: result, datum: todayStr });
  } catch (e) {
    console.error("[api/planning-orders-appjes]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
