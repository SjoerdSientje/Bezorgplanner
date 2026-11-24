import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import {
  importReparatieEstimateByNumber,
  isMoneybirdConfigured,
} from "@/lib/moneybird";

export const dynamic = "force-dynamic";

/**
 * GET /api/moneybird/estimates?nummer=2024-0042
 * Haalt een Moneybird-offerte op voor invullen in terugbreng-order.
 */
export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    if (!isMoneybirdConfigured()) {
      return NextResponse.json(
        { error: "Moneybird niet geconfigureerd." },
        { status: 500 }
      );
    }

    const nummer = String(
      request.nextUrl.searchParams.get("nummer") ?? ""
    ).trim();
    if (!nummer) {
      return NextResponse.json(
        { error: "Offertenummer is verplicht." },
        { status: 400 }
      );
    }

    const imported = await importReparatieEstimateByNumber(nummer);
    if (!imported) {
      return NextResponse.json(
        { error: `Geen offerte gevonden met nummer “${nummer}”.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ estimate: imported });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Offerte ophalen mislukt.";
    console.error("[api/moneybird/estimates]", e);
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
