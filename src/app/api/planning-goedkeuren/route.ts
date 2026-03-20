import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getPlanningDateForGoedkeuren } from "@/lib/planning-date";

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
    const body = await request.json().catch(() => ({}));
    const mode: "replace" | "morgen" = body.mode === "morgen" ? "morgen" : "replace";

    const supabase = createServerSupabaseClient();
    const { date: planningDate } = getPlanningDateForGoedkeuren();

    // Orders ophalen die in aanmerking komen
    const { data: orders, error: queryError } = await supabase
      .from("orders")
      .select("id, order_nummer, aankomsttijd_slot")
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

    // Verwijder altijd de bestaande slots voor deze datum.
    // - "replace": vervangt de huidige dag-planning volledig.
    // - "morgen": vervangt de morgen-planning volledig (zelfde gedrag, andere datum).
    await supabase.from("planning_slots").delete().eq("datum", planningDate);

    const slotsToInsert = sorted.map((o, i) => ({
      datum: planningDate,
      order_id: o.id,
      volgorde: i + 1,
      aankomsttijd: (o.aankomsttijd_slot ?? "").toString().trim(),
      tijd_opmerking: "",
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

    return NextResponse.json({
      ok: true,
      message:
        mode === "replace"
          ? `Planning vervangen: ${sorted.length} order(s) in de planning gezet.`
          : `${sorted.length} order(s) toegevoegd als ritjes voor morgen.`,
      count: sorted.length,
      planningDate,
      mode,
    });
  } catch (e) {
    console.error("[api/planning-goedkeuren]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
