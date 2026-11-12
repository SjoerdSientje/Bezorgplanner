import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { sortRitjesOrdersNewestFirst } from "@/lib/ritjes-mapping";
import { requireAccountEmail } from "@/lib/account";
import { filterOutPausedMpOrders, isMpPausedForOwner } from "@/lib/mp-pause";
import { repairCompletedOrdersWithWrongStatus } from "@/lib/order-completion";
import { rollForwardPastPlanningSlots } from "@/lib/planning-promote";

export const dynamic = "force-dynamic";

/** Kolommen die Ritjes/Alle ritten/Lijst Sjoerd nodig hebben — geen select("*"). */
const RITJES_ORDER_SELECT = [
  "id",
  "created_at",
  "updated_at",
  "source",
  "status",
  "type",
  "order_nummer",
  "naam",
  "adres_url",
  "bel_link",
  "aankomsttijd_slot",
  "bezorgtijd_voorkeur",
  "meenemen_in_planning",
  "datum_opmerking",
  "opmerkingen_klant",
  "producten",
  "line_items_json",
  "bestelling_totaal_prijs",
  "al_betaald",
  "te_betalen",
  "betaald",
  "volledig_adres",
  "telefoon_nummer",
  "telefoon_e164",
  "order_id",
  "datum",
  "aantal_fietsen",
  "email",
  "model",
  "mp_tags",
  "planning_kleur",
  "planning_opmerking",
  "route_nummer",
  "route_naam",
  "leg_nummer",
  "rit_nummer",
].join(", ");

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();

    // Repair + roll-forward eerst (muterend), daarna reads parallel.
    await Promise.all([
      repairCompletedOrdersWithWrongStatus(supabase, ownerEmail),
      rollForwardPastPlanningSlots(ownerEmail, supabase as any),
    ]);

    const [mpPaused, ordersResult, planningResult] = await Promise.all([
      isMpPausedForOwner(supabase, ownerEmail),
      supabase
        .from("orders")
        .select(RITJES_ORDER_SELECT)
        .eq("owner_email", ownerEmail)
        .eq("status", "ritjes_vandaag")
        .is("afgerond_at", null),
      supabase
        .from("planning_slots")
        .select("order_id, datum")
        .eq("owner_email", ownerEmail)
        .neq("status", "afgerond"),
    ]);

    const { data: dataRaw, error } = ordersResult;
    if (error) {
      console.error("[ritjes-vandaag]", error);
      return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
    }
    const { data: planningSlots, error: planningErr } = planningResult;
    if (planningErr) {
      console.error("[ritjes-vandaag planning-slots]", planningErr);
      return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
    }

    const data = filterOutPausedMpOrders(
      (dataRaw ?? []) as unknown as Array<{
        source?: unknown;
        status?: unknown;
        mp_tags?: unknown;
        order_nummer?: unknown;
        [key: string]: unknown;
      }>,
      mpPaused
    );

    const slotDatumByOrderId = new Map<string, string>();
    for (const s of planningSlots ?? []) {
      const id = String((s as Record<string, unknown>).order_id ?? "").trim();
      const d = String((s as Record<string, unknown>).datum ?? "").trim();
      if (!id || !d) continue;
      const prev = slotDatumByOrderId.get(id);
      if (!prev || d < prev) slotDatumByOrderId.set(id, d);
    }

    // Sluit naleveren/garantie orders uit — die horen alleen in de pakketjes paklijst.
    // Alleen matchen als het veld BEGINT met het keyword (bijv. "Garantie: koplamp"),
    // zodat producten die 'garantie' in de beschrijving bevatten niet wegvallen.
    const NALEVEREN_START_RE = /^\s*(naleveren|nalevering|garantie)\s*:/i;
    const isNaleverenOrder = (o: Record<string, unknown>): boolean => {
      const prijs = parseFloat(String(o.bestelling_totaal_prijs ?? 0));
      if (prijs > 0) return false; // €0-orders zijn de enige kandidaten
      const producten = String(o.producten ?? "");
      const opmerkingen = String(o.opmerkingen_klant ?? "");
      return NALEVEREN_START_RE.test(producten) || NALEVEREN_START_RE.test(opmerkingen);
    };

    const orders = sortRitjesOrdersNewestFirst(
      (data ?? [])
        .filter((o) => !isNaleverenOrder(o as Record<string, unknown>))
        .map((o) => {
          const id = String((o as Record<string, unknown>).id ?? "").trim();
          return {
            ...o,
            in_morgen_tab: slotDatumByOrderId.has(id),
            planning_slot_datum: slotDatumByOrderId.get(id) ?? null,
          };
        })
    );

    return NextResponse.json(
      { orders },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[ritjes-vandaag]", e);
    return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
  }
}
