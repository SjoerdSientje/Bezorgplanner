import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getPlanningDateForGoedkeuren } from "@/lib/planning-date";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";
import { requireAccountEmail } from "@/lib/account";
import { verwerkGarantiebewijs } from "@/lib/garantiebewijs";

function shouldSendPlanningGoedkeurenWhatsApp(
  order: {
    meenemen_in_planning?: boolean | null;
    nieuw_appje_sturen?: boolean | null;
    datum_opmerking?: string | null;
    datum?: string | null;
  },
  planningDate: string
): boolean {
  if (order.meenemen_in_planning !== true) return false;
  if (order.nieuw_appje_sturen !== true) return false;

  const datumOpmerking = String(order.datum_opmerking ?? "").trim().toLowerCase();
  const hasVandaagInOpmerking = datumOpmerking.includes("vandaag");
  const datumFromOrder = String(order.datum ?? "").trim();
  const datumIsPlanningDate = datumFromOrder === planningDate;

  return hasVandaagInOpmerking || datumIsPlanningDate;
}

/**
 * POST /api/planning-goedkeuren
 * Body: { mode: "replace" | "morgen" }
 *
 * "replace": verwijdert de bestaande planning_slots voor planningDate en zet nieuwe slots.
 * "morgen":  houdt de bestaande slots staan; voegt de nieuwe slots toe voor planningDate.
 *            Zo blijven bezorgingen die nog bezig zijn staan als aparte sectie.
 *
 * planningDate = vandaag (vóór 17:00) of morgen (vanaf 17:00).
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));
    const mode: "replace" | "morgen" = body.mode === "morgen" ? "morgen" : "replace";

    const supabase = createServerSupabaseClient();
    const { date: planningDate } = getPlanningDateForGoedkeuren();

    // Orders ophalen die in aanmerking komen
    const { data: orders, error: queryError } = await supabase
      .from("orders")
      .select("id, order_nummer, aankomsttijd_slot, bestelling_totaal_prijs, naam, telefoon_e164, telefoon_nummer, type, betaald, mp_tags, datum, datum_opmerking, meenemen_in_planning, nieuw_appje_sturen, opmerkingen_klant, bezorgtijd_voorkeur, email, producten, serienummer, aantal_fietsen, link_aankoopbewijs")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .eq("meenemen_in_planning", true)
      .not("aankomsttijd_slot", "is", null)
      .or(`datum_opmerking.ilike.%vandaag%,datum.eq.${planningDate}`);

    if (queryError) {
      console.error("[api/planning-goedkeuren]", queryError);
      return NextResponse.json(
        { error: "Orders ophalen mislukt." },
        { status: 500 }
      );
    }

    const rows = (orders ?? []).filter(
      (o) => (o.aankomsttijd_slot ?? "").toString().trim().length > 0
    );
    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Geen orders om goed te keuren (geen orders met tijdslot die voldoen aan de criteria).",
        count: 0,
        planningDate,
        mode,
      });
    }

    const sorted = [...rows].sort((a, b) => {
      const startA = ((a.aankomsttijd_slot ?? "").toString().split(" - ")[0] ?? "");
      const startB = ((b.aankomsttijd_slot ?? "").toString().split(" - ")[0] ?? "");
      return startA.localeCompare(startB);
    });

    // Zorg dat MP orders een aankoopbewijs-link hebben na goedkeuren.
    // Criteria: order_nummer begint met #MP (MPA/MPB...) en link_aankoopbewijs ontbreekt.
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

    // Verwijder altijd de bestaande slots voor deze datum.
    // - "replace": vervangt de huidige dag-planning volledig.
    // - "morgen": vervangt de morgen-planning volledig (zelfde gedrag, andere datum).
    await supabase
      .from("planning_slots")
      .delete()
      .eq("owner_email", ownerEmail)
      .eq("datum", planningDate);

    const slotsToInsert = sorted.map((o, i) => ({
      owner_email: ownerEmail,
      datum: planningDate,
      order_id: o.id,
      volgorde: i + 1,
      aankomsttijd: (o.aankomsttijd_slot ?? "").toString().trim(),
      // Toon de voorkeur uit "Ritjes vandaag" in de planning.
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

    // Belangrijk: we veranderen orders.status niet hier.
    // "Ritjes voor vandaag" toont alleen orders met status 'ritjes_vandaag';
    // ze moeten pas verdwijnen zodra ze via 'afronden' naar 'bezorgd'/'mp_orders' gaan.

    // Na goedkeuren: WhatsApp tijdslot-bericht per ordertype
    const whatsappCandidates = sorted.filter((o) =>
      shouldSendPlanningGoedkeurenWhatsApp(
        {
          meenemen_in_planning: o.meenemen_in_planning as boolean | null | undefined,
          nieuw_appje_sturen: o.nieuw_appje_sturen as boolean | null | undefined,
          datum_opmerking: o.datum_opmerking as string | null | undefined,
          datum: o.datum as string | null | undefined,
        },
        planningDate
      )
    );

    const whatsappDetails: string[] = [];
    let whatsappSent = 0;
    let whatsappFailed = 0;
    for (const o of whatsappCandidates as any[]) {
      const sendRes = await sendWhatsAppByEvent(
        "planning_goedgekeurd",
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
          datum: o.datum ?? planningDate,
          opmerkingen_klant: o.opmerkingen_klant,
          bezorgtijd_voorkeur: o.bezorgtijd_voorkeur,
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
      message:
        mode === "replace"
          ? `Planning vervangen: ${sorted.length} order(s) in de planning gezet.`
          : `${sorted.length} order(s) toegevoegd als ritjes voor morgen.`,
      count: sorted.length,
      planningDate,
      mode,
      whatsapp: {
        candidates: whatsappCandidates.length,
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
