import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getOrderKind,
  resolveConfiguredTemplateForOrder,
  type WhatsAppOrderInput,
  type WhatsAppEvent,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_nummer, naam, type, betaald, mp_tags, status, opmerkingen_klant, bezorgtijd_voorkeur, aankomsttijd_slot, telefoon_e164, telefoon_nummer, created_at"
      )
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

