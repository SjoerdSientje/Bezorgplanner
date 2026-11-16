import { NextRequest, NextResponse } from "next/server";
import {
  mayCreateMoneybirdInvoicesForOwner,
  requireAccountEmail,
} from "@/lib/account";
import { searchKlanten } from "@/lib/klanten";

export const dynamic = "force-dynamic";

/** Zoek/lijst klanten (Moneybird + afgeronde MP-orders, dedupe op e-mail). */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();
    const includeMoneybird = mayCreateMoneybirdInvoicesForOwner(ownerEmail);

    const customers = await searchKlanten(ownerEmail, {
      query: q,
      includeMoneybird,
      limit: 100,
    });

    return NextResponse.json(
      { customers },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Klanten laden mislukt.";
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message, customers: [] }, { status });
  }
}
