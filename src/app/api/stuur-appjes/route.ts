import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";
import { requireAccountEmail } from "@/lib/account";
import { getLatestOrNewPlanningDate } from "@/lib/planning-promote";

/**
 * POST /api/stuur-appjes
 * Body: { orders: Array<{ order_id; order_nummer; naam; aankomsttijd_slot; telefoon_e164;
 *                          telefoon_nummer; bezorgtijd_voorkeur; section: "nieuwe_order"|"nieuw_tijdslot" }> }
 *
 * - "nieuw_tijdslot": order staat al in planning → nieuw_tijdslot WhatsApp template.
 * - "nieuwe_order":  order staat NIET in planning → standaard template + toevoegen aan planning.
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}));
    const selected = (body.orders ?? []) as Array<{
      order_id: string;
      order_nummer: string;
      naam: string;
      aankomsttijd_slot: string;
      telefoon_e164: string;
      telefoon_nummer: string;
      bezorgtijd_voorkeur?: string;
      section: "nieuwe_order" | "nieuw_tijdslot";
    }>;

    if (selected.length === 0) {
      return NextResponse.json({ error: "Geen orders geselecteerd." }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Haal extra orderdata op (type, betaald, etc.) voor template-keuze
    const { data: ordersMeta } = await supabase
      .from("orders")
      .select(
        "id, status, type, betaald, mp_tags, datum, opmerkingen_klant, bezorgtijd_voorkeur, bestelling_totaal_prijs"
      )
      .eq("owner_email", ownerEmail)
      .in(
        "id",
        selected.map((o) => o.order_id)
      );
    const metaById = new Map(
      (ordersMeta ?? []).map((o: Record<string, unknown>) => [String(o.id), o])
    );

    // Sync handmatig aangepaste tijdslot terug naar bestaande planning_slots (voor "nieuw_tijdslot")
    for (const o of selected.filter((o) => o.section === "nieuw_tijdslot")) {
      if (!o.aankomsttijd_slot) continue;
      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: o.aankomsttijd_slot })
        .eq("owner_email", ownerEmail)
        .eq("order_id", o.order_id);
    }

    // Voor "nieuwe_order": toevoegen aan planning
    const nieuweOrderOrders = selected.filter((o) => o.section === "nieuwe_order");
    if (nieuweOrderOrders.length > 0) {
      const targetDate = await getLatestOrNewPlanningDate(ownerEmail, supabase as any);

      // Bepaal hoogste volgorde voor die datum
      const { data: existingSlots } = await supabase
        .from("planning_slots")
        .select("volgorde")
        .eq("owner_email", ownerEmail)
        .eq("datum", targetDate)
        .order("volgorde", { ascending: false })
        .limit(1);
      const maxVolgorde =
        existingSlots && existingSlots.length > 0
          ? Number((existingSlots[0] as Record<string, unknown>).volgorde ?? 0)
          : 0;

      // Verwijder eventuele bestaande slots voor deze orders op die datum (vermijd duplicaten)
      await supabase
        .from("planning_slots")
        .delete()
        .eq("owner_email", ownerEmail)
        .eq("datum", targetDate)
        .in("order_id", nieuweOrderOrders.map((o) => o.order_id));

      const slotsToInsert = nieuweOrderOrders.map((o, i) => ({
        owner_email: ownerEmail,
        datum: targetDate,
        order_id: o.order_id,
        volgorde: maxVolgorde + i + 1,
        aankomsttijd: o.aankomsttijd_slot,
        tijd_opmerking: String(
          (metaById.get(o.order_id) as Record<string, unknown> | undefined)?.bezorgtijd_voorkeur ?? o.bezorgtijd_voorkeur ?? ""
        ),
      }));

      const { error: insertErr } = await supabase
        .from("planning_slots")
        .insert(slotsToInsert);
      if (insertErr) {
        console.error("[api/stuur-appjes] planning insert:", insertErr);
      }

      // meenemen_in_planning op false zodat ze niet nogmaals via goedkeuren worden meegenomen
      await supabase
        .from("orders")
        .update({ meenemen_in_planning: false })
        .eq("owner_email", ownerEmail)
        .in("id", nieuweOrderOrders.map((o) => o.order_id));
    }

    // Verstuur WhatsApp per order
    const details: string[] = [];
    let sentCount = 0;
    let failCount = 0;

    for (const o of selected) {
      const meta = (metaById.get(o.order_id) ?? {}) as Record<string, unknown>;

      // "nieuwe_order" → standaard template (in_planning_en_ritjes_vandaag = false)
      // "nieuw_tijdslot" → nieuw_tijdslot template (in_planning_en_ritjes_vandaag = true)
      const inPlanningEnRitjesVandaag = o.section === "nieuw_tijdslot";

      const sendRes = await sendWhatsAppByEvent(
        "stuur_appjes",
        {
          order_nummer: o.order_nummer,
          naam: o.naam,
          aankomsttijd_slot: o.aankomsttijd_slot,
          bestelling_totaal_prijs: (meta.bestelling_totaal_prijs as number | null) ?? null,
          telefoon_e164: o.telefoon_e164,
          telefoon_nummer: o.telefoon_nummer,
          type: String(meta.type ?? ""),
          betaald: (meta.betaald as boolean | null) ?? null,
          mp_tags: String(meta.mp_tags ?? ""),
          datum: String(meta.datum ?? ""),
          opmerkingen_klant: String(meta.opmerkingen_klant ?? ""),
          bezorgtijd_voorkeur: String(meta.bezorgtijd_voorkeur ?? ""),
          in_planning_en_ritjes_vandaag: inPlanningEnRitjesVandaag,
        },
        { ownerEmail }
      );

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
    });
  } catch (e) {
    console.error("[api/stuur-appjes]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
