import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";

/**
 * POST /api/stuur-appjes
 * Body: { orders: Array<{ order_id: string; aankomsttijd_slot: string; telefoon_e164: string; naam: string }> }
 *
 * Stuurt WhatsApp berichten met het nieuwe tijdslot naar de geselecteerde klanten.
 * Template + verzendlogica volgt (Make.com webhook / WhatsApp Business API).
 * Voor nu: update planning_slots.aankomsttijd met het nieuwe slot en log de orders.
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}));
    const selected = (body.orders ?? []) as Array<{
      order_id: string;
      slot_id: string;
      aankomsttijd_slot: string;
      telefoon_e164: string;
      telefoon_nummer: string;
      naam: string;
      order_nummer: string;
    }>;

    if (selected.length === 0) {
      return NextResponse.json(
        { error: "Geen orders geselecteerd." },
        { status: 400 }
      );
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // Sync handmatig aangepaste tijdslot terug naar planning_slots.
    // We updaten op `order_id` (en niet alleen `slot_id`) zodat het altijd klopt
    // als iemand een order in planning heeft die niet exact via deze slot-id matcht.
    for (const o of selected) {
      if (!o.aankomsttijd_slot) continue;

      // 1) Primary: update via slot_id (als aanwezig)
      if (o.slot_id) {
        await supabase
          .from("planning_slots")
          .update({ aankomsttijd: o.aankomsttijd_slot })
          .eq("id", o.slot_id);
      }

      // 2) Fallback/extra: update via order_id (covers date/slot mismatches)
      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: o.aankomsttijd_slot })
        .eq("order_id", o.order_id);
    }

    const details: string[] = [];
    let sentCount = 0;
    let failCount = 0;

    const { data: ordersMeta } = await supabase
      .from("orders")
      .select("id, type, opmerkingen_klant, bezorgtijd_voorkeur")
      .in("id", selected.map((o) => o.order_id));
    const metaById = new Map((ordersMeta ?? []).map((o: any) => [String(o.id), o]));

    for (const o of selected) {
      const meta = metaById.get(o.order_id) ?? {};
      const sendRes = await sendWhatsAppByEvent("stuur_appjes", {
        order_nummer: o.order_nummer,
        naam: o.naam,
        aankomsttijd_slot: o.aankomsttijd_slot,
        telefoon_e164: o.telefoon_e164,
        telefoon_nummer: o.telefoon_nummer,
        type: String((meta as any).type ?? ""),
        opmerkingen_klant: String((meta as any).opmerkingen_klant ?? ""),
        bezorgtijd_voorkeur: String((meta as any).bezorgtijd_voorkeur ?? ""),
      });
      if (sendRes.ok) {
        sentCount += 1;
        details.push(`Order ${o.order_nummer}: verzonden`);
      } else {
        failCount += 1;
        details.push(`Order ${o.order_nummer}: ${sendRes.error ?? "mislukt"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `${sentCount} verzonden, ${failCount} mislukt.`,
      details,
      orders: selected.map((o) => ({
        order_nummer: o.order_nummer,
        naam: o.naam,
        tijdslot: o.aankomsttijd_slot,
        telefoon: o.telefoon_e164 || o.telefoon_e164,
      })),
    });
  } catch (e) {
    console.error("[api/stuur-appjes]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
