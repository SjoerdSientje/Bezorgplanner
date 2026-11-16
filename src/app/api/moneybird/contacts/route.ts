import { NextRequest, NextResponse } from "next/server";
import {
  mayCreateMoneybirdInvoicesForOwner,
  requireAccountEmail,
} from "@/lib/account";
import {
  isMoneybirdConfigured,
  searchMoneybirdContactsByEmailPrefix,
} from "@/lib/moneybird";

export const dynamic = "force-dynamic";

/** Zoek Moneybird-klanten op e-mailprefix voor reparatie-autocomplete. */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    if (!mayCreateMoneybirdInvoicesForOwner(ownerEmail)) {
      return NextResponse.json({ contacts: [] });
    }
    if (!isMoneybirdConfigured()) {
      return NextResponse.json({ contacts: [], error: "Moneybird niet geconfigureerd." });
    }

    const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json({ contacts: [] });
    }

    const contacts = await searchMoneybirdContactsByEmailPrefix(q, { limit: 10 });
    return NextResponse.json(
      { contacts },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoeken mislukt.";
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message, contacts: [] }, { status });
  }
}
