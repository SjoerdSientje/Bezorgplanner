import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { cleanupStaleInventoryReservations } from "@/lib/inventory-reservations";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventory/reservations/cleanup
 * Body: { dryRun?: boolean, allOwners?: boolean }
 *
 * Wist verouderde reserveringen (order weg/afgerond/al afgeschreven)
 * zonder voorraad af te schrijven — alsof geannuleerd.
 */
export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = await request.json().catch(() => ({}));
    const dryRun = Boolean(body.dryRun);
    const allOwners = Boolean(body.allOwners);

    const supabase = createServerSupabaseClient();
    const result = await cleanupStaleInventoryReservations(supabase, {
      ownerEmail: allOwners ? null : ownerEmail,
      dryRun,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cleanup mislukt." },
      { status: 500 }
    );
  }
}
