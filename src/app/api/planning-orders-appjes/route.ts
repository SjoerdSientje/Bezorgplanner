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

    const { date: planningDate } = getPlanningDateForGoedkeuren();

    // Live source for "Stuur appjes":
    // orders currently in ritjes_vandaag with a timeslot and valid send flags/date.
    const { data: ordersData, error: ordersErr } = await supabase
      .from("orders")
      .select("id, order_nummer, naam, aankomsttijd_slot, telefoon_e164, telefoon_nummer, bezorgtijd_voorkeur, meenemen_in_planning, nieuw_appje_sturen, datum_opmerking, datum")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .eq("meenemen_in_planning", true)
      .eq("nieuw_appje_sturen", true)
      .not("aankomsttijd_slot", "is", null)
      .neq("aankomsttijd_slot", "")
      .eq("owner_email", ownerEmail)
      .or(`datum_opmerking.ilike.%vandaag%,datum.eq.${planningDate}`);

    if (ordersErr) {
      return NextResponse.json({ error: "Orders ophalen mislukt." }, { status: 500 });
    }
    const rows = (ordersData ?? [])
      .map((o) => ({
        slot_id: "", // optional for /api/stuur-appjes
        order_id: String(o.id ?? ""),
        volgorde: 0,
        order_nummer: String(o.order_nummer ?? ""),
        naam: String(o.naam ?? ""),
        aankomsttijd_slot: String(o.aankomsttijd_slot ?? ""),
        telefoon_e164: String(o.telefoon_e164 ?? ""),
        telefoon_nummer: String(o.telefoon_nummer ?? ""),
        bezorgtijd_voorkeur: String(o.bezorgtijd_voorkeur ?? ""),
      }))
      .sort((a, b) => {
        const sa = (a.aankomsttijd_slot.split(" - ")[0] ?? "").trim();
        const sb = (b.aankomsttijd_slot.split(" - ")[0] ?? "").trim();
        return sa.localeCompare(sb);
      })
      .map((o, idx) => ({ ...o, volgorde: idx + 1 }));

    if (rows.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    return NextResponse.json(
      { orders: rows, datum: planningDate },
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
