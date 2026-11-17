import { NextRequest, NextResponse } from "next/server";
import {
  mayCreateMoneybirdInvoicesForOwner,
  requireAccountEmail,
} from "@/lib/account";
import { getKlantById } from "@/lib/klanten";
import { listKlantOrderHistorie } from "@/lib/klant-orderhistorie";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Ordergeschiedenis van een klant: alle afgeronde orders met hetzelfde e-mailadres
 * (Shopify, MP, reparatie) — werkt terugwerkend zonder aparte backfill-tabel.
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(String(raw ?? "").trim());
    if (!id) {
      return NextResponse.json({ error: "id ontbreekt.", orders: [] }, { status: 400 });
    }

    const includeMoneybird = mayCreateMoneybirdInvoicesForOwner(ownerEmail);
    const customer = await getKlantById(ownerEmail, id, { includeMoneybird });
    if (!customer) {
      return NextResponse.json(
        { error: "Klant niet gevonden.", orders: [] },
        { status: 404 }
      );
    }

    if (!customer.email) {
      return NextResponse.json(
        { orders: [], customerEmail: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const orders = await listKlantOrderHistorie(ownerEmail, customer.email);
    return NextResponse.json(
      { orders, customerEmail: customer.email },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Ordergeschiedenis laden mislukt.";
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message, orders: [] }, { status });
  }
}
