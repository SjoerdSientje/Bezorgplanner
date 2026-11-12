import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import {
  attachMoneybirdFactuurForOrder,
  sendOrderFactuurByEmail,
  type OrderForFactuur,
} from "@/lib/order-factuur";

export const dynamic = "force-dynamic";

const ORDER_SELECT =
  "id, owner_email, source, type, status, order_id, order_nummer, email, moneybird_invoice_id, link_factuur, afgerond_at, mp_tags";

function isLikelyEmail(v: string): boolean {
  const s = String(v ?? "").trim();
  return s.includes("@") && s.includes(".");
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
    const { data: order, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("id", orderId)
      .eq("owner_email", ownerEmail)
      .maybeSingle<OrderForFactuur>();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!order) return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });

    let link = String(order.link_factuur ?? "").trim();
    let invoiceId = String(order.moneybird_invoice_id ?? "").trim() || null;

    if (!link) {
      try {
        const attached = await attachMoneybirdFactuurForOrder(supabase, order);
        link = String(attached.link ?? "").trim();
        invoiceId = attached.invoiceId ?? invoiceId;
      } catch (e) {
        console.error("[factuur GET] attach:", e);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        email: String(order.email ?? ""),
        link_factuur: link,
        moneybird_invoice_id: invoiceId,
        has_factuur: Boolean(link || invoiceId),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
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
    const { data: order, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("id", orderId)
      .eq("owner_email", ownerEmail)
      .maybeSingle<OrderForFactuur>();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!order) return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });

    const result = await sendOrderFactuurByEmail(supabase, order, requestedEmail);

    const { data: refreshed } = await supabase
      .from("orders")
      .select("link_factuur, moneybird_invoice_id, email")
      .eq("id", orderId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      invoiceId: result.invoiceId,
      link_factuur: String(refreshed?.link_factuur ?? order.link_factuur ?? ""),
      email: String(refreshed?.email ?? requestedEmail),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verzenden mislukt." },
      { status: 500 }
    );
  }
}
