import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { countIncompleteMpOrders, isMpPausedForOwner, setMpPaused, MP_PAUSE_OWNER_EMAIL } from "@/lib/mp-pause";

export const dynamic = "force-dynamic";

/**
 * Geheime veiligheidsschakelaar (los van de normale login), bereikbaar via een
 * onbekende URL + wachtwoord. Verwijdert nooit data — pauzeert alleen het tonen/
 * meenemen van niet-afgeronde MP-orders in de rest van de Bezorgplanner en
 * verbergt de "MP orders"-pagina, tot de schakelaar weer wordt omgezet.
 *
 * Body: { password: string, action: "check" | "toggle" }
 * - "check": alleen wachtwoord + huidige status + preview-aantal teruggeven.
 * - "toggle": wachtwoord opnieuw vereist; zet de schakelaar daadwerkelijk om.
 */
const MP_PANIC_PASSWORD = "FatBaiks2024!@#";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const password = String(body.password ?? "");
    const action = body.action === "toggle" ? "toggle" : "check";

    if (password !== MP_PANIC_PASSWORD) {
      return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
    }

    const supabase = createServerSupabaseClient();
    const ownerEmail = MP_PAUSE_OWNER_EMAIL;

    if (action === "toggle") {
      const currentlyPaused = await isMpPausedForOwner(supabase, ownerEmail);
      const nextPaused = !currentlyPaused;
      await setMpPaused(supabase, nextPaused);
      return NextResponse.json({ ok: true, paused: nextPaused });
    }

    const paused = await isMpPausedForOwner(supabase, ownerEmail);
    const activeMpOrderCount = await countIncompleteMpOrders(supabase, ownerEmail);
    return NextResponse.json({ ok: true, paused, activeMpOrderCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Onbekende fout." },
      { status: 500 }
    );
  }
}
