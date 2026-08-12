import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { promoteRitjesVoorMorgen } from "@/lib/planning-promote";
import { freezeRelativeDatumOpmerking } from "@/lib/planning-date";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slotId: string }> }
) {
  try {
    const ownerEmail = requireAccountEmail(_req);
    const slotId = (await params).slotId;
    if (!slotId) {
      return NextResponse.json({ error: "Slot-id ontbreekt." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: slot, error: slotErr } = await supabase
      .from("planning_slots")
      .select("id, order_id, datum")
      .eq("owner_email", ownerEmail)
      .eq("id", slotId)
      .maybeSingle();
    if (slotErr) {
      console.error("[api/planning-slots DELETE] read", slotErr);
      return NextResponse.json({ error: slotErr.message }, { status: 500 });
    }
    if (!slot?.id || !slot?.order_id) {
      return NextResponse.json({ error: "Planning-slot niet gevonden." }, { status: 404 });
    }

    const { error } = await supabase
      .from("planning_slots")
      .delete()
      .eq("owner_email", ownerEmail)
      .eq("id", slotId);
    if (error) {
      console.error("[api/planning-slots DELETE]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Voorkom dat de order met oud tijdslot + relatieve "vandaag" meteen weer in
    // Lijst Sjoerd / Planning goedkeuren belandt.
    const { data: orderRow } = await supabase
      .from("orders")
      .select("id, datum_opmerking")
      .eq("owner_email", ownerEmail)
      .eq("id", slot.order_id)
      .maybeSingle();

    const slotDatum = String(slot.datum ?? "").trim();
    const updatePayload: Record<string, unknown> = {
      aankomsttijd_slot: null,
      rit_nummer: null,
      route_nummer: null,
      route_naam: null,
    };
    if (slotDatum && orderRow) {
      updatePayload.datum_opmerking = freezeRelativeDatumOpmerking(
        orderRow.datum_opmerking,
        slotDatum
      );
    }

    await supabase
      .from("orders")
      .update(updatePayload)
      .eq("owner_email", ownerEmail)
      .eq("id", slot.order_id);

    // Als de planning nu leeg is, promoot ritjes voor morgen naar vandaag.
    await promoteRitjesVoorMorgen(ownerEmail, supabase as any);

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/planning-slots DELETE]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
