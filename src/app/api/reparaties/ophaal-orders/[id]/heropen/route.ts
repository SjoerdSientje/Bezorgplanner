import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { heropenWinkelafhaalNaarOphalen } from "@/lib/ophalen-vervolg";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Winkelafhaal terugdraaien → ophaal-wachtkamer.
 * Conceptofferte wordt verwijderd; daarna kan terugbrengen.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const { id } = await ctx.params;
    const result = await heropenWinkelafhaalNaarOphalen(
      createServerSupabaseClient(),
      ownerEmail,
      String(id ?? "").trim()
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Heropenen mislukt.";
    console.error("[ophaal-orders/heropen]", e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
