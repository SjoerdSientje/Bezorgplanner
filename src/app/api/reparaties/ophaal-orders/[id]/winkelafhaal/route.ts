import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { completeWinkelafhaalFromOphalen } from "@/lib/ophalen-vervolg";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const result = await completeWinkelafhaalFromOphalen(
      createServerSupabaseClient(),
      ownerEmail,
      String(id ?? "").trim(),
      body
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Afronden mislukt.";
    console.error("[ophaal-orders/winkelafhaal]", e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
