import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getPlanningDateForGoedkeuren,
  isDatumOpmerkingVandaagOfMorgen,
} from "@/lib/planning-date";
import { getTargetPlanningDate } from "@/lib/planning-promote";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";
import { requireAccountEmail } from "@/lib/account";
import { verwerkGarantiebewijs } from "@/lib/garantiebewijs";

/**
 * POST /api/planning-goedkeuren
 *
 * Verplaatst alle "ritjes vandaag"-orders met tijdslot naar planning_slots.
 * - Als planning leeg is: slots worden direct als planning gezet (vandaag/morgen op basis van 17:00).
 * - Als planning al actieve slots heeft: slots worden als "ritjes voor morgen" gezet (morgen).
 * WhatsApp wordt hier niet meer verstuurd; dat gaat via "Stuur appjes".
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);

    const supabase = createServerSupabaseClient();
    const { date: planningDate } = getPlanningDateForGoedkeuren();

    // Orders ophalen die in aanmerking komen
    const { data: orders, error: queryError } = await supabase
      .from("orders")
      .select("id, order_nummer, aankomsttijd_slot, bestelling_totaal_prijs, naam, telefoon_e164, telefoon_nummer, type, betaald, mp_tags, datum, datum_opmerking, meenemen_in_planning, opmerkingen_klant, bezorgtijd_voorkeur, email, producten, serienummer, aantal_fietsen, link_aankoopbewijs")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .eq("meenemen_in_planning", true)
      .not("aankomsttijd_slot", "is", null);

    if (queryError) {
      console.error("[api/planning-goedkeuren]", queryError);
      return NextResponse.json(
        { error: "Orders ophalen mislukt." },
        { status: 500 }
      );
    }

    const rows = (orders ?? []).filter((o) => {
      if ((o.aankomsttijd_slot ?? "").toString().trim().length === 0) return false;
      const datumOpmerkingOk = isDatumOpmerkingVandaagOfMorgen(o.datum_opmerking);
      const datumIsPlanningDate = String(o.datum ?? "").trim() === planningDate;
      return datumOpmerkingOk || datumIsPlanningDate;
    });

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Geen orders om goed te keuren (geen orders met tijdslot die voldoen aan de criteria).",
        count: 0,
        planningDate,
      });
    }

    const sorted = [...rows].sort((a, b) => {
      const startA = ((a.aankomsttijd_slot ?? "").toString().split(" - ")[0] ?? "");
      const startB = ((b.aankomsttijd_slot ?? "").toString().split(" - ")[0] ?? "");
      return startA.localeCompare(startB);
    });

    // Zorg dat MP orders een aankoopbewijs-link hebben na goedkeuren.
    for (const o of sorted as any[]) {
      const orderNummer = String(o.order_nummer ?? "").trim();
      const isMp = /^#MP/i.test(orderNummer);
      const hasLink = String(o.link_aankoopbewijs ?? "").trim() !== "";
      if (!isMp || hasLink) continue;

      try {
        const garantieLink = await verwerkGarantiebewijs(
          {
            order_id: String(o.id),
            order_nummer: o.order_nummer ?? null,
            naam: o.naam ?? null,
            email: o.email ?? null,
            producten: o.producten ?? null,
            serienummer: o.serienummer ?? null,
            totaal_prijs:
              o.bestelling_totaal_prijs != null ? Number(o.bestelling_totaal_prijs) : null,
            aantal_fietsen:
              o.aantal_fietsen != null ? Number(o.aantal_fietsen) : null,
            datum: new Date().toLocaleDateString("nl-NL"),
          },
          supabase as any
        );

        await supabase
          .from("orders")
          .update({ link_aankoopbewijs: garantieLink })
          .eq("owner_email", ownerEmail)
          .eq("id", String(o.id));
      } catch (err) {
        console.error("[api/planning-goedkeuren] garantiebewijs fout voor", orderNummer, err);
      }
    }

    // Bepaal de doeldatum: leeg planning → planningDate; anders → morgen (ritjes voor morgen)
    const { date: targetDate, isRitjesVoorMorgen } = await getTargetPlanningDate(ownerEmail, supabase as any);

    // Verwijder eventuele bestaande slots voor die doeldatum (vermijd duplicaten).
    await supabase
      .from("planning_slots")
      .delete()
      .eq("owner_email", ownerEmail)
      .eq("datum", targetDate);

    const slotsToInsert = sorted.map((o, i) => ({
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

    // Zet meenemen_in_planning op false zodat orders niet nogmaals worden meegenomen.
    const plannedOrderIds = sorted.map((o) => String(o.id));
    const { error: updateOrdersErr } = await supabase
      .from("orders")
      .update({ meenemen_in_planning: false })
      .eq("owner_email", ownerEmail)
      .in("id", plannedOrderIds);
    if (updateOrdersErr) {
      console.error("[api/planning-goedkeuren] update order toggles:", updateOrdersErr);
    }

    // Stuur WhatsApp-bericht per order — altijd de standaard template op basis van ordertype,
    // nooit nieuw_tijdslot (in_planning_en_ritjes_vandaag = false).
    const whatsappDetails: string[] = [];
    let whatsappSent = 0;
    let whatsappFailed = 0;
    for (const o of sorted as any[]) {
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
          datum: o.datum ?? targetDate,
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
        ? `${sorted.length} order(s) als ritjes voor morgen toegevoegd.`
        : `${sorted.length} order(s) in de planning gezet.`,
      count: sorted.length,
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
