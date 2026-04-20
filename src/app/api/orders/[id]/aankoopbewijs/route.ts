import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { verwerkGarantiebewijs } from "@/lib/garantiebewijs";

type OrderForAankoopbewijs = {
  id: string;
  owner_email: string;
  order_nummer: string | null;
  naam: string | null;
  email: string | null;
  producten: string | null;
  model: string | null;
  serienummer: string | null;
  bestelling_totaal_prijs: number | null;
  aantal_fietsen: number | null;
  link_aankoopbewijs: string | null;
};

function isLikelyEmail(v: string): boolean {
  const s = String(v ?? "").trim();
  return s.includes("@") && s.includes(".");
}

function extractModelnaam(producten: string | null): string {
  if (!producten) return "";
  const match = producten.match(/^(.+?)\s+fatbike/i);
  return match ? match[1].trim() : String(producten).trim();
}

function toPdfDraft(order: OrderForAankoopbewijs) {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return {
    naam: String(order.naam ?? ""),
    datum: `${dd}-${mm}-${yyyy}`,
    fiets: String(order.model ?? "") || extractModelnaam(order.producten),
    prijs:
      order.bestelling_totaal_prijs != null
        ? `€ ${Number(order.bestelling_totaal_prijs).toFixed(2)}`
        : "",
    serienummer: String(order.serienummer ?? ""),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const orderId = String(params.id ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "Order ID ontbreekt." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: order, error: readErr } = await supabase
      .from("orders")
      .select(
        "id, owner_email, order_nummer, naam, email, producten, model, serienummer, bestelling_totaal_prijs, aantal_fietsen, link_aankoopbewijs"
      )
      .eq("id", orderId)
      .eq("owner_email", ownerEmail)
      .maybeSingle<OrderForAankoopbewijs>();

    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    if (!order) return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });

    return NextResponse.json({
      ok: true,
      email: String(order.email ?? ""),
      link_aankoopbewijs: String(order.link_aankoopbewijs ?? ""),
      pdf: toPdfDraft(order),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const orderId = String(params.id ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "Order ID ontbreekt." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedEmail = String(body.email ?? "").trim();
    if (!isLikelyEmail(requestedEmail)) {
      return NextResponse.json({ error: "Ongeldig e-mailadres." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: order, error: readErr } = await supabase
      .from("orders")
      .select(
        "id, owner_email, order_nummer, naam, email, producten, model, serienummer, bestelling_totaal_prijs, aantal_fietsen, link_aankoopbewijs"
      )
      .eq("id", orderId)
      .eq("owner_email", ownerEmail)
      .maybeSingle<OrderForAankoopbewijs>();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
    }

    const garantieLink = await verwerkGarantiebewijs(
      {
        order_id: order.id,
        order_nummer: order.order_nummer,
        naam: order.naam,
        email: requestedEmail,
        producten: order.producten,
        model: order.model,
        serienummer: order.serienummer,
        totaal_prijs: order.bestelling_totaal_prijs,
        aantal_fietsen: order.aantal_fietsen,
        datum: new Date().toLocaleDateString("nl-NL"),
      },
      supabase,
      {
        pdfOverrides: {
          naam: body?.pdf?.naam ?? null,
          datum: body?.pdf?.datum ?? null,
          fiets: body?.pdf?.fiets ?? null,
          prijs: body?.pdf?.prijs ?? null,
          serienummer: body?.pdf?.serienummer ?? null,
        },
      }
    );

    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        email: requestedEmail,
        link_aankoopbewijs: garantieLink,
      })
      .eq("id", order.id)
      .eq("owner_email", ownerEmail);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      link_aankoopbewijs: garantieLink,
      email: requestedEmail,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

