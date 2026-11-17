import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { isMpPausedForOwner } from "@/lib/mp-pause";

export const dynamic = "force-dynamic";

/** Huidige MP-pauze status voor navigatie (sidebar). */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const paused = await isMpPausedForOwner(
      createServerSupabaseClient(),
      ownerEmail
    );
    return NextResponse.json(
      { paused },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Status ophalen mislukt.";
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message, paused: false }, { status });
  }
}
