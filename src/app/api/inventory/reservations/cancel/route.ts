import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import {
  clearReservationsForOrder,
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
 * Handmatig annuleren van een open reservering:
 * alleen reservering(en) wissen — géén voorraadaftrek.
 */
export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = (await request.json().catch(() => ({}))) as {
      source?: string;
      externalOrderId?: string;
    };

    const source = String(body.source ?? "").trim() as InventoryReservationSource;
    const externalOrderId = String(body.externalOrderId ?? "").trim();

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
    const cleared = await clearReservationsForOrder(
      supabase,
      ownerEmail,
      source,
      externalOrderId
    );

    return NextResponse.json(
      { ok: true, cleared },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Annuleren mislukt." },
      { status: 500 }
    );
  }
}
