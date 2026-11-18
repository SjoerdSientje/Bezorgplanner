import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { createTerugbrengenFromOphalen } from "@/lib/ophalen-vervolg";

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
    const result = await createTerugbrengenFromOphalen(
      createServerSupabaseClient(),
      ownerEmail,
      String(id ?? "").trim(),
      body
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Aanmaken mislukt.";
    console.error("[ophaal-orders/terugbrengen]", e);
    const status = /niet ingelogd|unauthorized|401/i.test(message)
      ? 401
      : /niet gevonden|wachtkamer|afgehandeld/i.test(message)
        ? 400
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
