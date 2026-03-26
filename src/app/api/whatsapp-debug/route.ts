import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getOrderKind,
  resolveConfiguredTemplateForOrder,
  type WhatsAppOrderInput,
  type WhatsAppEvent,
} from "@/lib/whatsapp";
import {
  getPlanningDateForGoedkeuren,
  isDatumOpmerkingVandaagOfMorgen,
} from "@/lib/planning-date";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

function isPlanningGoedkeurenRecipient(o: {
  meenemen_in_planning?: boolean | null;
  nieuw_appje_sturen?: boolean | null;
  datum_opmerking?: string | null;
  datum?: string | null;
}): boolean {
  const { date: planningDate } = getPlanningDateForGoedkeuren();
  if (o.meenemen_in_planning !== true) return false;
  if (o.nieuw_appje_sturen !== true) return false;
  const hasVandaagOfMorgenInOpmerking = isDatumOpmerkingVandaagOfMorgen(o.datum_opmerking);
  const datumIsPlanningDate = String(o.datum ?? "").trim() === planningDate;
  return hasVandaagOfMorgenInOpmerking || datumIsPlanningDate;
}

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_nummer, naam, type, betaald, mp_tags, status, opmerkingen_klant, bezorgtijd_voorkeur, aankomsttijd_slot, telefoon_e164, telefoon_nummer, meenemen_in_planning, nieuw_appje_sturen, datum_opmerking, datum, created_at"
      )
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const events: WhatsAppEvent[] = ["planning_goedgekeurd", "stuur_appjes", "afronden"];
    const rows = (data ?? []).map((o: any) => {
      const order: WhatsAppOrderInput = {
        order_nummer: o.order_nummer,
        naam: o.naam,
        aankomsttijd_slot: o.aankomsttijd_slot,
        telefoon_e164: o.telefoon_e164,
        telefoon_nummer: o.telefoon_nummer,
        type: o.type,
        betaald: o.betaald,
        mp_tags: o.mp_tags,
        opmerkingen_klant: o.opmerkingen_klant,
        bezorgtijd_voorkeur: o.bezorgtijd_voorkeur,
      };
      const kind = getOrderKind(order);
      const templates = Object.fromEntries(
        events.map((evt) => {
          const t = resolveConfiguredTemplateForOrder(evt, order);
          return [
            evt,
            t
              ? { name: t.name, language: t.language ?? "nl" }
              : { name: null, language: null },
          ];
        })
      );

      return {
        id: o.id,
        order_nummer: o.order_nummer,
        naam: o.naam,
        type: o.type,
        inferred_kind: kind,
        aankomsttijd_slot: o.aankomsttijd_slot,
        telefoon: o.telefoon_e164 || o.telefoon_nummer || null,
        meenemen_in_planning: o.meenemen_in_planning,
        nieuw_appje_sturen: o.nieuw_appje_sturen,
        datum_opmerking: o.datum_opmerking,
        datum: o.datum,
        planning_goedgekeurd_recipient: isPlanningGoedkeurenRecipient(o),
        templates,
      };
    });

    return NextResponse.json({ orders: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

