import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { listRecenteWinkelafhaal } from "@/lib/ophalen-vervolg";

export const dynamic = "force-dynamic";

/** Lijst ophaal-wachtkamer + recente winkelafhaal (≤7 dagen, nog open offerte). */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_nummer, naam, email, telefoon_nummer, volledig_adres, producten, model, achtergrondverhaal, opgehaald_at, created_at, voorrij_bedrag, voorrij_km, opmerkingen_klant"
      )
      .eq("owner_email", ownerEmail)
      .eq("source", "reparatie")
      .eq("type", "reparatie_ophalen")
      .eq("status", "opgehaald")
      .is("ophalen_afgehandeld_via", null)
      .order("opgehaald_at", { ascending: false, nullsFirst: false });

    if (error) throw new Error(error.message);

    let recenteWinkelafhaal: Awaited<
      ReturnType<typeof listRecenteWinkelafhaal>
    > = [];
    try {
      recenteWinkelafhaal = await listRecenteWinkelafhaal(supabase, ownerEmail);
    } catch (e) {
      console.error("[ophaal-orders] recente winkelafhaal", e);
    }

    return NextResponse.json({
      orders: data ?? [],
      recenteWinkelafhaal,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Laden mislukt.";
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json(
      { error: message, orders: [], recenteWinkelafhaal: [] },
      { status }
    );
  }
}
