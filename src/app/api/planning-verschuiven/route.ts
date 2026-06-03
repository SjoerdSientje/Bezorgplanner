import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";
import { requireAccountEmail } from "@/lib/account";

function shiftTimeSlot(slot: string, delayMinutes: number): string {
  const match = slot.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!match) return slot;
  const startMins = parseInt(match[1]) * 60 + parseInt(match[2]) + delayMinutes;
  const endMins = parseInt(match[3]) * 60 + parseInt(match[4]) + delayMinutes;
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(startMins)} - ${fmt(endMins)}`;
}

/**
 * POST /api/planning-verschuiven
 * Body: { vertragingMinuten: number }
 *
 * Verschuift alle actieve planning-slots (status != afgerond) met N minuten
 * en stuurt een nieuw_tijdslot WhatsApp naar elke betrokken order.
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase niet geconfigureerd." }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const vertragingMinuten = Number(body.vertragingMinuten ?? 0);
    if (!Number.isFinite(vertragingMinuten) || vertragingMinuten <= 0) {
      return NextResponse.json(
        { error: "Geef een geldig positief getal voor vertraging (minuten)." },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Haal alle actieve planning_slots op
    const { data: slots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("id, order_id, datum, aankomsttijd")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond");

    if (slotsErr) {
      console.error("[planning-verschuiven] slots ophalen:", slotsErr);
      return NextResponse.json({ error: "Planning ophalen mislukt." }, { status: 500 });
    }
    if (!slots || slots.length === 0) {
      return NextResponse.json({ ok: true, message: "Geen actieve planning gevonden.", count: 0 });
    }

    // Bereken nieuwe tijdsloten
    const updated = slots.map((s: Record<string, unknown>) => ({
      id: s.id,
      order_id: String(s.order_id ?? ""),
      datum: String(s.datum ?? ""),
      oudeTijd: String(s.aankomsttijd ?? ""),
      nieuweTijd: shiftTimeSlot(String(s.aankomsttijd ?? ""), vertragingMinuten),
    }));

    // Haal order-metadata op voor WhatsApp template
    const orderIds = updated.map((u) => u.order_id).filter(Boolean);
    const { data: ordersMeta } = await supabase
      .from("orders")
      .select("id, naam, order_nummer, telefoon_e164, telefoon_nummer, type, betaald, mp_tags, bestelling_totaal_prijs, opmerkingen_klant, bezorgtijd_voorkeur")
      .eq("owner_email", ownerEmail)
      .in("id", orderIds);
    const metaById = new Map(
      (ordersMeta ?? []).map((o: Record<string, unknown>) => [String(o.id), o])
    );

    // Update planning_slots en orders.aankomsttijd_slot per order
    for (const u of updated) {
      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: u.nieuweTijd })
        .eq("owner_email", ownerEmail)
        .eq("id", u.id);

      if (u.order_id) {
        await supabase
          .from("orders")
          .update({ aankomsttijd_slot: u.nieuweTijd })
          .eq("owner_email", ownerEmail)
          .eq("id", u.order_id);
      }
    }

    // Verstuur nieuw_tijdslot WhatsApp per order
    const details: string[] = [];
    let sentCount = 0;
    let failCount = 0;

    for (const u of updated) {
      if (!u.order_id) continue;
      const meta = (metaById.get(u.order_id) ?? {}) as Record<string, unknown>;
      const naam = String(meta.naam ?? "");
      const orderNummer = String(meta.order_nummer ?? "");
      const telefoonE164 = meta.telefoon_e164 ? String(meta.telefoon_e164) : null;
      const telefoonNummer = meta.telefoon_nummer ? String(meta.telefoon_nummer) : null;

      if (!telefoonE164 && !telefoonNummer) {
        failCount += 1;
        details.push(`Order ${orderNummer}: geen telefoonnummer`);
        continue;
      }

      const sendRes = await sendWhatsAppByEvent(
        "stuur_appjes",
        {
          order_nummer: orderNummer,
          naam,
          aankomsttijd_slot: u.nieuweTijd,
          bestelling_totaal_prijs: (meta.bestelling_totaal_prijs as number | null) ?? null,
          telefoon_e164: telefoonE164,
          telefoon_nummer: telefoonNummer,
          type: String(meta.type ?? ""),
          betaald: (meta.betaald as boolean | null) ?? null,
          mp_tags: String(meta.mp_tags ?? ""),
          datum: u.datum,
          opmerkingen_klant: String(meta.opmerkingen_klant ?? ""),
          bezorgtijd_voorkeur: String(meta.bezorgtijd_voorkeur ?? ""),
          // nieuw_tijdslot template (zelfde als bestaande order in planning)
          in_planning_en_ritjes_vandaag: true,
        },
        { ownerEmail }
      );

      if (sendRes.ok) {
        sentCount += 1;
        details.push(`Order ${orderNummer} (${naam}): nieuw tijdslot ${u.nieuweTijd} verzonden`);
      } else {
        failCount += 1;
        details.push(`Order ${orderNummer}: ${sendRes.error ?? "mislukt"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Planning verschoven met ${vertragingMinuten} min. ${sentCount} appjes verzonden, ${failCount} mislukt.`,
      details,
      count: updated.length,
    });
  } catch (e) {
    console.error("[api/planning-verschuiven]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
