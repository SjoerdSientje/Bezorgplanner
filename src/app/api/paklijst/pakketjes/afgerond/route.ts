import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

/** Verwijdert alle pakketjes-orders voor het ingelogde account (ronde afgerond). */
export async function POST(_request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(_request);
    const supabase = createServerSupabaseClient();

    const nowIso = new Date().toISOString();

    const { error: cErr } = await supabase.from("pakketjes_owner_cutoff").upsert(
      {
        owner_email: ownerEmail,
        ignore_shopify_created_before: nowIso,
      },
      { onConflict: "owner_email" }
    );
    if (cErr) {
      throw new Error(cErr.message);
    }

    const { error } = await supabase.from("pakketjes_orders").delete().eq("owner_email", ownerEmail);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Afronden mislukt." },
      { status: 500 }
    );
  }
}
