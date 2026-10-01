import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";

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
  "planning_kleur",
  "planning_opmerking",
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ownerEmail = requireAccountEmail(_request);
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
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("id", id)
      .maybeSingle();
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
    const ownerEmail = requireAccountEmail(_request);
    const id = (await params).id;
    if (!id) {
      return NextResponse.json({ error: "Order-id ontbreekt." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select(
        "id, source, type, status, reparatie_betaalwijze, moneybird_invoice_id, order_nummer, order_id"
      )
      .eq("owner_email", ownerEmail)
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) {
      console.error("[api/orders DELETE] fetch", fetchErr);
      return NextResponse.json(
        { error: "Order ophalen mislukt.", detail: fetchErr.message },
        { status: 500 }
      );
    }
    if (!order) {
      return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
    }

    const source = String(order.source ?? "").toLowerCase();

    // Reserveringen vrijgeven (geen voorraadaftrek) — alsof de order is geannuleerd.
    try {
      const { clearReservationsForOrder } = await import(
        "@/lib/inventory-reservations"
      );
      if (source === "mp") {
        await clearReservationsForOrder(supabase, ownerEmail, "marktplaats", id, {
          skipAlerts: true,
        });
      } else if (source === "shopify") {
        const shopifyOrderId = String(order.order_id ?? "").trim();
        if (shopifyOrderId) {
          await clearReservationsForOrder(
            supabase,
            ownerEmail,
            "shopify",
            shopifyOrderId,
            { skipAlerts: true }
          );
        }
      }
    } catch (resErr) {
      console.error("[api/orders DELETE] reservations:", resErr);
    }

    // Reparatie: conceptfactuur verwijderen als die op factuur stond (alleen drafts).
    if (
      source === "reparatie" &&
      String(order.reparatie_betaalwijze ?? "") === "factuur"
    ) {
      try {
        const { deleteReparatieSalesInvoice } = await import("@/lib/moneybird");
        await deleteReparatieSalesInvoice({
          orderId: id,
          invoiceId: order.moneybird_invoice_id as string | null,
        });
      } catch (mbErr) {
        console.error("[api/orders DELETE] reparatie invoice:", mbErr);
      }
    }

    // Planning-slots expliciet weg (cascade dekt dit ook, maar dit is duidelijker).
    await supabase
      .from("planning_slots")
      .delete()
      .eq("owner_email", ownerEmail)
      .eq("order_id", id);

    const { data: deletedRows, error } = await supabase
      .from("orders")
      .delete()
      .select("id")
      .eq("owner_email", ownerEmail)
      .eq("id", id);
    if (error) {
      console.error("[api/orders DELETE]", error);
      return NextResponse.json(
        { error: "Verwijderen mislukt.", detail: error.message },
        { status: 500 }
      );
    }
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
    }

    try {
      const { promoteRitjesVoorMorgen } = await import("@/lib/planning-promote");
      await promoteRitjesVoorMorgen(ownerEmail, supabase as any);
    } catch (promoErr) {
      console.error("[api/orders DELETE] promote:", promoErr);
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
    const ownerEmail = requireAccountEmail(_request);
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
    const { error } = await supabase
      .from("orders")
      .update(updates)
      .eq("owner_email", ownerEmail)
      .eq("id", id);

    if (error) {
      console.error("[api/orders PATCH]", error);
      return NextResponse.json(
        { error: "Bijwerken mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    if (updates.meenemen_in_planning === false) {
      await supabase
        .from("orders")
        .update({
          aankomsttijd_slot: null,
          rit_nummer: null,
          route_nummer: null,
        })
        .eq("owner_email", ownerEmail)
        .eq("id", id);
      await supabase
        .from("planning_slots")
        .delete()
        .eq("owner_email", ownerEmail)
        .eq("order_id", id)
        .neq("status", "afgerond");
    }

    // Als aankomsttijd_slot is aangepast, sync ook planning_slots.aankomsttijd
    // zodat de Planning-pagina direct het nieuwe tijdslot toont.
    if ("aankomsttijd_slot" in updates) {
      const nieuweAankomsttijd = (updates.aankomsttijd_slot as string) ?? null;
      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: nieuweAankomsttijd })
        .eq("owner_email", ownerEmail)
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
