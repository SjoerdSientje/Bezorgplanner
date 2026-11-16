import { NextRequest, NextResponse } from "next/server";
import {
  mayCreateMoneybirdInvoicesForOwner,
  requireAccountEmail,
} from "@/lib/account";
import { getKlantById } from "@/lib/klanten";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Eén klant ophalen (id = mb:… of mp:…). */
export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(String(raw ?? "").trim());
    if (!id) {
      return NextResponse.json({ error: "id ontbreekt." }, { status: 400 });
    }

    const includeMoneybird = mayCreateMoneybirdInvoicesForOwner(ownerEmail);
    const customer = await getKlantById(ownerEmail, id, { includeMoneybird });
    if (!customer) {
      return NextResponse.json({ error: "Klant niet gevonden." }, { status: 404 });
    }

    return NextResponse.json(
      { customer },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Klant laden mislukt.";
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
