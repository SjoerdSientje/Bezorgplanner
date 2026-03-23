import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase";

/** Velden die via PATCH mogen worden geüpdatet (whitelist). */
const ALLOWED_KEYS = new Set([
  "order_nummer",
  "naam",
  "adres_url",
  "bel_link",
  "bezorgtijd_voorkeur",
  "meenemen_in_planning",
  "nieuw_appje_sturen",
  "datum_opmerking",
  "opmerkingen_klant",
  "producten",
  "bestelling_totaal_prijs",
  "betaald",
  "betaalmethode",
  "volledig_adres",
  "telefoon_nummer",
  "order_id",
  "datum",
  "aantal_fietsen",
  "email",
  "telefoon_e164",
  "model",
  "serienummer",
  "link_aankoopbewijs",
  "bezorger_naam",
  "betaald_bedrag",
  "aankomsttijd_slot",
  "mp_tags",
  "line_items_json",
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    if (!id) {
      return NextResponse.json({ error: "Order-id ontbreekt." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
    if (error) {
      console.error("[api/orders GET]", error);
      return NextResponse.json(
        { error: "Ophalen mislukt.", detail: error.message },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
    }

    return NextResponse.json({ order: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/orders GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    if (!id) {
      return NextResponse.json({ error: "Order-id ontbreekt." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) {
      console.error("[api/orders DELETE]", error);
      return NextResponse.json(
        { error: "Verwijderen mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/orders DELETE]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    if (!id) {
      return NextResponse.json({ error: "Order-id ontbreekt." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const body = await _request.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (ALLOWED_KEYS.has(key)) {
        updates[key] = body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Geen toegestane velden om te updaten." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from("orders").update(updates).eq("id", id);

    if (error) {
      console.error("[api/orders PATCH]", error);
      return NextResponse.json(
        { error: "Bijwerken mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    // Als aankomsttijd_slot is aangepast, sync ook planning_slots.aankomsttijd
    // zodat de Planning-pagina direct het nieuwe tijdslot toont.
    if ("aankomsttijd_slot" in updates) {
      const nieuweAankomsttijd = (updates.aankomsttijd_slot as string) ?? null;
      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: nieuweAankomsttijd })
        .eq("order_id", id);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/orders PATCH]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
