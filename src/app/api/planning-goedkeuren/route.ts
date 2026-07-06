import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getAmsterdamCalendarDate, orderIntendedForPlanningDateKey } from "@/lib/planning-date";
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
        "id, order_nummer, aankomsttijd_slot, route_nummer, rit_nummer, bestelling_totaal_prijs, naam, telefoon_e164, telefoon_nummer, type, betaald, mp_tags, datum, datum_opmerking, meenemen_in_planning, opmerkingen_klant, bezorgtijd_voorkeur, email, producten, serienummer, aantal_fietsen, link_aankoopbewijs"
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

    // Orders die al in een actieve planning_slot zitten (Routes-tab) nooit opnieuw indelen.
    const { data: activeSlots } = await supabase
      .from("planning_slots")
      .select("order_id")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond");

    const alreadyPlannedIds = new Set(
      (activeSlots ?? []).map((s: { order_id: string }) => String(s.order_id))
    );

    const rows = (orders ?? []).filter((o) => {
      if ((o.aankomsttijd_slot ?? "").toString().trim().length === 0) return false;
      if (alreadyPlannedIds.has(String(o.id ?? ""))) return false;
      if (!orderIntendedForPlanningDateKey(o, targetDate)) return false;
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
    const batchOrders = [...rows].sort((a, b) => {
      const ra =
        a.route_nummer != null && Number(a.route_nummer) > 0 ? Number(a.route_nummer) : 9999;
      const rb =
        b.route_nummer != null && Number(b.route_nummer) > 0 ? Number(b.route_nummer) : 9999;
      if (ra !== rb) return ra - rb;
      const sa = a.rit_nummer != null && Number(a.rit_nummer) > 0 ? Number(a.rit_nummer) : 9999;
      const sb = b.rit_nummer != null && Number(b.rit_nummer) > 0 ? Number(b.rit_nummer) : 9999;
      if (sa !== sb) return sa - sb;
      return (
        parseMin((a.aankomsttijd_slot ?? "").toString()) -
        parseMin((b.aankomsttijd_slot ?? "").toString())
      );
    });

    // Verwijder alleen de slots voor orders in deze batch (niet alle slots voor targetDate —
    // andere orders die al gepland staan voor die datum blijven onberoerd).
    const batchOrderIds = batchOrders.map((o) => String(o.id));
    if (batchOrderIds.length > 0) {
      await supabase
        .from("planning_slots")
        .delete()
        .eq("owner_email", ownerEmail)
        .eq("datum", targetDate)
        .in("order_id", batchOrderIds);
    }

    const slotsToInsert: {
      owner_email: string;
      datum: string;
      order_id: string;
      volgorde: number;
      aankomsttijd: string;
      tijd_opmerking: string;
    }[] = [];

    let volgordeInRoute = 0;
    let lastRouteKey: string | null = null;

    for (const o of batchOrders) {
      const routeKey =
        o.route_nummer != null && Number(o.route_nummer) > 0
          ? String(o.route_nummer)
          : "single";
      if (routeKey !== lastRouteKey) {
        volgordeInRoute = 0;
        lastRouteKey = routeKey;
      }
      volgordeInRoute += 1;

      slotsToInsert.push({
        owner_email: ownerEmail,
        datum: targetDate,
        order_id: o.id,
        volgorde: volgordeInRoute,
        aankomsttijd: (o.aankomsttijd_slot ?? "").toString().trim(),
        tijd_opmerking: String(o.bezorgtijd_voorkeur ?? "").toString().trim(),
      });
    }

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
