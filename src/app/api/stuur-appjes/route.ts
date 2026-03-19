import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    // TODO: WhatsApp berichten sturen via Make.com webhook of WhatsApp Business API
    // Template volgt. Payload per order: { naam, aankomsttijd_slot, telefoon_e164 }
    const makeWebhookUrl = process.env.MAKE_WEBHOOK_URL_PLANNING_APPROVED;
    let webhookResults: string[] = [];
    if (makeWebhookUrl) {
      try {
        const webhookRes = await fetch(makeWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "tijdslot_update",
            orders: selected.map((o) => ({
              order_nummer: o.order_nummer,
              naam: o.naam,
              nieuw_tijdslot: o.aankomsttijd_slot,
              telefoon_e164: o.telefoon_e164,
            })),
          }),
        });
        webhookResults = webhookRes.ok
          ? ["Make.com webhook verstuurd."]
          : [`Make.com webhook fout: ${webhookRes.status}`];
      } catch (err) {
        webhookResults = [`Make.com webhook fout: ${err instanceof Error ? err.message : String(err)}`];
      }
    } else {
      webhookResults = ["MAKE_WEBHOOK_URL_PLANNING_APPROVED niet ingesteld — appje template volgt."];
    }

    return NextResponse.json({
      ok: true,
      message: `${selected.length} appje(s) verzonden.`,
      details: webhookResults,
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
