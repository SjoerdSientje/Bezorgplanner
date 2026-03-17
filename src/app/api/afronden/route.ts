import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const PAYMENT_OPTIONS = new Set([
  "Was al betaald",
  "Factuur betaling aan deur",
  "Contant aan deur",
  "Anders",
]);

function isMpTagged(mpTags: unknown): boolean {
  const t = String(mpTags ?? "").toLowerCase();
  // Match zowel "MP" als "mp" als losse tag of onderdeel van comma/space-separated tekst
  return /\bmp\b/.test(t);
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const orderId = String(body.orderId ?? "").trim();
    const bezorgerNaam = String(body.bezorger_naam ?? "").trim();
    const betaalOptie = String(body.betaal_optie ?? "").trim();
    const betaalAnders = String(body.betaal_anders ?? "").trim();

    if (!orderId) {
      return NextResponse.json({ error: "Order-id ontbreekt." }, { status: 400 });
    }
    if (!bezorgerNaam) {
      return NextResponse.json({ error: "Naam bezorger ontbreekt." }, { status: 400 });
    }
    if (!PAYMENT_OPTIONS.has(betaalOptie)) {
      return NextResponse.json({ error: "Ongeldige betaaloptie." }, { status: 400 });
    }
    const betaalmethode =
      betaalOptie === "Anders" ? (betaalAnders || "Anders") : betaalOptie;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Haal order op om MP-tag te bepalen
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, source, mp_tags")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) {
      console.error("[api/afronden] order", orderErr);
      return NextResponse.json({ error: "Order ophalen mislukt." }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
    }

    const toMpOrders = isMpTagged(order.mp_tags);
    const nextStatus = toMpOrders ? "mp_orders" : "bezorgd";

    // Update order afrond-info + status
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        bezorger_naam: bezorgerNaam,
        betaalmethode,
        afgerond_at: new Date().toISOString(),
        status: nextStatus,
      })
      .eq("id", orderId);

    if (updErr) {
      console.error("[api/afronden] update", updErr);
      return NextResponse.json({ error: "Order bijwerken mislukt." }, { status: 500 });
    }

    // Verwijder uit planning zodat hij niet meer zichtbaar is
    const { error: delErr } = await supabase
      .from("planning_slots")
      .delete()
      .eq("order_id", orderId);
    if (delErr) {
      console.error("[api/afronden] delete planning_slots", delErr);
      // Niet hard failen: order is wel afgerond
    }

    return NextResponse.json(
      { ok: true, nextStatus },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/afronden]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

