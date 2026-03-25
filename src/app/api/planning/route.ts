import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

/**
 * GET /api/planning
 * Returns planning rows (planning_slots + order data) for the Bezorgplanner sheet.
 */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data: slots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("id, datum, volgorde, aankomsttijd, tijd_opmerking, status, order_id")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond")
      .order("datum", { ascending: true })
      .order("volgorde", { ascending: true });

    if (slotsErr) {
      console.error("[api/planning]", slotsErr);
      return NextResponse.json(
        { error: "Planning ophalen mislukt." },
        { status: 500 }
      );
    }

    const slotList = slots ?? [];
    if (slotList.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const orderIds = slotList.map((s: { order_id: string }) => s.order_id);
    const { data: ordersData, error: ordersErr } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .in("id", orderIds);

    if (ordersErr) {
      console.error("[api/planning] orders", ordersErr);
      return NextResponse.json(
        { error: "Orders ophalen mislukt." },
        { status: 500 }
      );
    }

    const ordersById = new Map(
      (ordersData ?? []).map((o: Record<string, unknown>) => [o.id, o])
    );

    const rows = slotList
      .map((slot: Record<string, unknown>) => {
        const o = (ordersById.get(slot.order_id) as Record<string, unknown> | undefined) ?? {};
        const oStatus = String(o.status ?? "");

        // We tonen alleen orders die nog actief in de planning zitten.
        // Zodra je een order afrondt, zet je `orders.status` naar `bezorgd`/`mp_orders`.
        // Ook als `planning_slots` nog even blijven bestaan, mogen ze dan niet meer in de Planning sheet verschijnen.
        if (oStatus !== "ritjes_vandaag" && oStatus !== "gepland") return null;

        const source = String(o.source ?? "");
        const betaaldBool = o.betaald === true;
        const betaalwijze =
          source === "mp"
            ? "contant aan deur"
            : betaaldBool
              ? "was al betaald"
              : "Factuur betaling aan deur";

        const bezorgtijdVoorkeur = String(o.bezorgtijd_voorkeur ?? "").trim();
        const tijdOpmerking = bezorgtijdVoorkeur || String(slot.tijd_opmerking ?? "").trim();

        return {
          slot_id: slot.id,
          order_id: slot.order_id,
          datum: slot.datum,
          volgorde: slot.volgorde,
          aankomsttijd: slot.aankomsttijd ?? "",
          tijd_opmerking: tijdOpmerking,
          order_nummer: o.order_nummer ?? "",
          naam: o.naam ?? "",
          adres_url: o.adres_url ?? "",
          bel_link: o.bel_link ?? "",
          bestelling_totaal_prijs: o.bestelling_totaal_prijs ?? "",
          betaald: o.betaald ?? false,
          betaalwijze,
          aantal_fietsen: o.aantal_fietsen ?? "",
          producten: o.producten ?? "",
          opmerking_klant: o.opmerkingen_klant ?? "",
          volledig_adres: o.volledig_adres ?? "",
          telefoon_nummer: o.telefoon_nummer ?? "",
          email: o.email ?? "",
          link_aankoopbewijs: o.link_aankoopbewijs ?? "",
        };
      })
      .filter((r) => r != null);

    return NextResponse.json(
      { rows },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (e) {
    console.error("[api/planning]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
