import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getAmsterdamCalendarDate } from "@/lib/planning-date";
import { getTargetPlanningDate } from "@/lib/planning-promote";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";
import { requireAccountEmail } from "@/lib/account";
/**
 * POST /api/planning-goedkeuren
 *
 * Verplaatst alle "ritjes vandaag"-orders met tijdslot naar planning_slots.
 * - Als planning leeg is: slots worden direct als planning gezet (vandaag/morgen: 18:00 Amsterdam, zie planning-date).
 * - Als planning al actieve slots heeft: nieuwe slots op morgen — alle ritjes met tijdslot die
 *   nog niet op planning vandaag staan (Routes-tab), behalve expliciet "vandaag" in datum_opmerking.
 * Na het opslaan van planning_slots wordt per order ook WhatsApp geprobeerd (zelfde templates als "Stuur appjes").
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);

    const supabase = createServerSupabaseClient();
    const todayKey = getAmsterdamCalendarDate(0);

    // Eerst doeldatum: bij actieve planning → morgen-batch; anders vandaag/morgen via 18:00-regel
    const { date: targetDate, isRitjesVoorMorgen } = await getTargetPlanningDate(
      ownerEmail,
      supabase as any
    );

    // Orders ophalen die in aanmerking komen
    const { data: orders, error: queryError } = await supabase
      .from("orders")
      .select(
        "id, order_nummer, aankomsttijd_slot, bestelling_totaal_prijs, naam, telefoon_e164, telefoon_nummer, type, betaald, mp_tags, datum, datum_opmerking, meenemen_in_planning, opmerkingen_klant, bezorgtijd_voorkeur, email, producten, serienummer, aantal_fietsen, link_aankoopbewijs"
      )
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .eq("meenemen_in_planning", true)
      .not("aankomsttijd_slot", "is", null);

    if (queryError) {
      console.error("[api/planning-goedkeuren]", queryError);
      return NextResponse.json(
        {
          error: "Orders ophalen mislukt.",
          detail: queryError.message,
        },
        { status: 500 }
      );
    }

    // Haal alle actieve planning-slots op (datum + order_id) om dubbele inserts te voorkomen.
    const { data: activeSlots } = await supabase
      .from("planning_slots")
      .select("order_id, datum")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond");

    // Orders die al op targetDate staan hoeven niet opnieuw te worden ingevoegd.
    const alreadyOnTargetDate = new Set(
      (activeSlots ?? [])
        .filter((s: { datum: string | null }) => String(s.datum ?? "") === targetDate)
        .map((s: { order_id: string }) => String(s.order_id))
    );

    // Orders die actief onderweg/gepland zijn op vandaag (lopende rit) sluiten we uit:
    // die horen bij de huidige bezorgronde en niet in een nieuwe batch.
    const busyTodayIds = new Set(
      (activeSlots ?? [])
        .filter((s: { datum: string | null }) => String(s.datum ?? "") === todayKey)
        .map((s: { order_id: string }) => String(s.order_id))
    );

    const rows = (orders ?? []).filter((o) => {
      if ((o.aankomsttijd_slot ?? "").toString().trim().length === 0) return false;
      const orderId = String(o.id ?? "");
      // Al ingepland op de doeldatum → overslaan (zou anders dubbel staan)
      if (alreadyOnTargetDate.has(orderId)) return false;
      // Actief in de huidige bezorgronde vandaag → niet naar een nieuwe batch
      if (busyTodayIds.has(orderId)) return false;
      return true;
    });

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        message: isRitjesVoorMorgen
          ? "Geen orders voor morgen om goed te keuren (lopende ritjes van vandaag blijven staan)."
          : "Geen orders om goed te keuren (geen orders met tijdslot die voldoen aan de criteria).",
        count: 0,
        planningDate: targetDate,
        isRitjesVoorMorgen,
      });
    }

    const parseMin = (slot: string) => {
      const t = String(slot ?? "").split(" - ")[0].replace(".", ":").trim();
      const [h, m] = t.split(":").map((x) => parseInt(x, 10));
      if (!Number.isFinite(h)) return 9999;
      return h * 60 + (Number.isFinite(m) ? m : 0);
    };
    const batchOrders = [...rows].sort(
      (a, b) =>
        parseMin((a.aankomsttijd_slot ?? "").toString()) -
        parseMin((b.aankomsttijd_slot ?? "").toString())
    );

    // Verwijder eventuele bestaande slots voor die doeldatum (vermijd duplicaten).
    await supabase
      .from("planning_slots")
      .delete()
      .eq("owner_email", ownerEmail)
      .eq("datum", targetDate);

    const slotsToInsert = batchOrders.map((o, i) => ({
      owner_email: ownerEmail,
      datum: targetDate,
      order_id: o.id,
      volgorde: i + 1,
      aankomsttijd: (o.aankomsttijd_slot ?? "").toString().trim(),
      tijd_opmerking: String(o.bezorgtijd_voorkeur ?? "").toString().trim(),
    }));

    const { error: insertErr } = await supabase.from("planning_slots").insert(slotsToInsert);
    if (insertErr) {
      console.error("[api/planning-goedkeuren] insert:", insertErr);
      return NextResponse.json(
        { error: "Planning opslaan mislukt.", detail: insertErr.message },
        { status: 500 }
      );
    }


    // Stuur WhatsApp-bericht per order — altijd de standaard template op basis van ordertype,
    // nooit nieuw_tijdslot (in_planning_en_ritjes_vandaag = false).
    const whatsappDetails: string[] = [];
    let whatsappSent = 0;
    let whatsappFailed = 0;
    for (const o of batchOrders as any[]) {
      const sendRes = await sendWhatsAppByEvent(
        "stuur_appjes",
        {
          order_nummer: o.order_nummer,
          naam: o.naam,
          aankomsttijd_slot: o.aankomsttijd_slot,
          bestelling_totaal_prijs: o.bestelling_totaal_prijs,
          telefoon_e164: o.telefoon_e164,
          telefoon_nummer: o.telefoon_nummer,
          type: o.type,
          betaald: o.betaald,
          mp_tags: o.mp_tags,
          datum: targetDate,
          opmerkingen_klant: o.opmerkingen_klant,
          bezorgtijd_voorkeur: o.bezorgtijd_voorkeur,
          in_planning_en_ritjes_vandaag: false,
        },
        { ownerEmail }
      );
      if (sendRes.ok) {
        whatsappSent += 1;
        whatsappDetails.push(`Order ${o.order_nummer}: verzonden`);
      } else {
        whatsappFailed += 1;
        whatsappDetails.push(`Order ${o.order_nummer}: ${sendRes.error ?? "mislukt"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: isRitjesVoorMorgen
        ? `${batchOrders.length} order(s) als ritjes voor morgen toegevoegd.`
        : `${batchOrders.length} order(s) in de planning gezet.`,
      count: batchOrders.length,
      planningDate: targetDate,
      isRitjesVoorMorgen,
      whatsapp: {
        sent: whatsappSent,
        failed: whatsappFailed,
        details: whatsappDetails,
      },
    });
  } catch (e) {
    console.error("[api/planning-goedkeuren]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
