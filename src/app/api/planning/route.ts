import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * GET /api/planning
 * Returns planning rows (planning_slots + order data) for the Bezorgplanner sheet.
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
    const { data: slots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("id, datum, volgorde, aankomsttijd, tijd_opmerking, status, order_id")
      .order("datum", { ascending: true })
      .order("volgorde", { ascending: true });

    if (slotsErr) {
      console.error("[api/planning]", slotsErr);
      return NextResponse.json(
        { error: "Planning ophalen mislukt." },
        { status: 500 }
      );
    }

    const slotList = slots ?? [];
    if (slotList.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const orderIds = slotList.map((s: { order_id: string }) => s.order_id);
    const { data: ordersData, error: ordersErr } = await supabase
      .from("orders")
      .select("*")
      .in("id", orderIds);

    if (ordersErr) {
      console.error("[api/planning] orders", ordersErr);
      return NextResponse.json(
        { error: "Orders ophalen mislukt." },
        { status: 500 }
      );
    }

    const ordersById = new Map(
      (ordersData ?? []).map((o: Record<string, unknown>) => [o.id, o])
    );

    const rows = slotList.map((slot: Record<string, unknown>) => {
      const o = ordersById.get(slot.order_id) as Record<string, unknown> | undefined ?? {};
      return {
        slot_id: slot.id,
        order_id: slot.order_id,
        datum: slot.datum,
        volgorde: slot.volgorde,
        aankomsttijd: slot.aankomsttijd ?? "",
        tijd_opmerking: slot.tijd_opmerking ?? "",
        order_nummer: o.order_nummer ?? "",
        naam: o.naam ?? "",
        adres_url: o.adres_url ?? "",
        bel_link: o.bel_link ?? "",
        bestelling_totaal_prijs: o.bestelling_totaal_prijs ?? "",
        betaald: o.betaald ?? "",
        aantal_fietsen: o.aantal_fietsen ?? "",
        producten: o.producten ?? "",
        opmerking_klant: o.opmerkingen_klant ?? "",
        volledig_adres: o.volledig_adres ?? "",
        telefoon_nummer: o.telefoon_nummer ?? "",
        email: o.email ?? "",
        link_aankoopbewijs: "", // Leeg voor nu, later voor MP
      };
    });

    return NextResponse.json(
      { rows },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (e) {
    console.error("[api/planning]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
