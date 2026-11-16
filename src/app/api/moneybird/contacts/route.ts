import { NextRequest, NextResponse } from "next/server";
import {
  mayCreateMoneybirdInvoicesForOwner,
  requireAccountEmail,
} from "@/lib/account";
import {
  isMoneybirdConfigured,
  searchMoneybirdContactsByEmailPrefix,
} from "@/lib/moneybird";
import type { MoneybirdContactSuggestion } from "@/lib/moneybird-contact-shared";
import { searchMpOrderCustomersByEmailPrefix } from "@/lib/mp-order-customers";

export const dynamic = "force-dynamic";

/**
 * Zoek klanten op e-mailprefix:
 * - Moneybird-contacten (als geconfigureerd + toegestaan)
 * - Klanten uit afgeronde MP-orders
 * Zelfde e-mail in beide → alleen Moneybird tonen (geen dubbel).
 */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);

    const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json({ contacts: [] });
    }

    const includeMoneybird =
      mayCreateMoneybirdInvoicesForOwner(ownerEmail) && isMoneybirdConfigured();

    const [mbResult, mpResult] = await Promise.allSettled([
      includeMoneybird
        ? searchMoneybirdContactsByEmailPrefix(q, { limit: 10 })
        : Promise.resolve([] as MoneybirdContactSuggestion[]),
      searchMpOrderCustomersByEmailPrefix(ownerEmail, q, { limit: 10 }),
    ]);

    const mbContacts =
      mbResult.status === "fulfilled" ? mbResult.value : [];
    const mpContacts =
      mpResult.status === "fulfilled" ? mpResult.value : [];

    const seenEmails = new Set(
      mbContacts.map((c) => c.email.trim().toLowerCase()).filter(Boolean)
    );

    const mpOnly = mpContacts.filter((c) => {
      const email = c.email.trim().toLowerCase();
      if (!email || seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    });

    const contacts = [...mbContacts, ...mpOnly].slice(0, 12);

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
