import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import {
  commitReservationsForOrder,
  type InventoryReservationSource,
} from "@/lib/inventory-reservations";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SOURCES = new Set<InventoryReservationSource>([
  "shopify",
  "marktplaats",
  "reparatie",
]);

/**
 * Handmatig afronden van een open reservering:
 * voorraad aftrekken + reservering(en) voor die order wissen.
 * Geen factuur, geen orderstatus, verder niets.
 */
export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = (await request.json().catch(() => ({}))) as {
      source?: string;
      externalOrderId?: string;
      orderReference?: string | null;
    };

    const source = String(body.source ?? "").trim() as InventoryReservationSource;
    const externalOrderId = String(body.externalOrderId ?? "").trim();
    const orderReference =
      String(body.orderReference ?? "").trim() || externalOrderId;

    if (!SOURCES.has(source)) {
      return NextResponse.json(
        { error: "Ongeldige source (shopify|marktplaats|reparatie)." },
        { status: 400 }
      );
    }
    if (!externalOrderId) {
      return NextResponse.json(
        { error: "externalOrderId is verplicht." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const result = await commitReservationsForOrder(supabase, {
      ownerEmail,
      source,
      externalOrderId,
      orderReference,
    });

    return NextResponse.json(
      {
        ok: true,
        committed: result.committed,
        skippedReason: result.skippedReason ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Afronden mislukt." },
      { status: 500 }
    );
  }
}
