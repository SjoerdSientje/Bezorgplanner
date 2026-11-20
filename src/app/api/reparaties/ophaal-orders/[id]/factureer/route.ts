import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { factureerWinkelafhaalEstimate } from "@/lib/ophalen-vervolg";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Conceptofferte → factuur aanmaken + versturen. */
export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const { id } = await ctx.params;
    const result = await factureerWinkelafhaalEstimate(
      createServerSupabaseClient(),
      ownerEmail,
      String(id ?? "").trim()
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Factureren mislukt.";
    console.error("[ophaal-orders/factureer]", e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
