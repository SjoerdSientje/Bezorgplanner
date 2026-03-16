import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  passesRitjesFilter,
  mapShopifyOrderToRitjesRow,
  type ShopifyOrder,
} from "@/lib/shopify-order";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const order = JSON.parse(raw) as ShopifyOrder;

    if (!passesRitjesFilter(order)) {
      return NextResponse.json({ ok: true, skipped: "filter" }, { status: 200 });
    }

    const row = mapShopifyOrderToRitjesRow(order);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("order_id", row.order_id)
      .eq("source", "shopify")
      .maybeSingle();

    const insertRow = {
      source: row.source,
      type: row.type,
      status: row.status,
      order_nummer: row.order_nummer,
      naam: row.naam,
      adres_url: row.adres_url,
      bel_link: row.bel_link,
      bezorgtijd_voorkeur: row.bezorgtijd_voorkeur,
      meenemen_in_planning: row.meenemen_in_planning,
      nieuw_appje_sturen: row.nieuw_appje_sturen,
      datum_opmerking: row.datum_opmerking,
      opmerkingen_klant: row.opmerkingen_klant,
      producten: row.producten,
      bestelling_totaal_prijs: row.bestelling_totaal_prijs,
      betaald: row.betaald,
      volledig_adres: row.volledig_adres,
      telefoon_nummer: row.telefoon_nummer,
      order_id: row.order_id,
      datum: row.datum,
      aantal_fietsen: row.aantal_fietsen,
      email: row.email,
      telefoon_e164: row.telefoon_e164,
      model: row.model,
      serienummer: row.serienummer,
      mp_tags: row.mp_tags,
    };

    if (existing) {
      await supabase.from("orders").update(insertRow).eq("id", existing.id);
      return NextResponse.json({ ok: true, updated: existing.id }, { status: 200 });
    }

    const { data: inserted, error } = await supabase
      .from("orders")
      .insert(insertRow)
      .select("id")
      .single();

    if (error) {
      console.error("[webhooks/shopify] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: inserted?.id }, { status: 200 });
  } catch (e) {
    console.error("[webhooks/shopify]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
