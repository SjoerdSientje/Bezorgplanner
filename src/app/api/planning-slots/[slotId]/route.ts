import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slotId: string }> }
) {
  try {
    const slotId = (await params).slotId;
    if (!slotId) {
      return NextResponse.json({ error: "Slot-id ontbreekt." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase niet geconfigureerd." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { error } = await supabase.from("planning_slots").delete().eq("id", slotId);
    if (error) {
      console.error("[api/planning-slots DELETE]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/planning-slots DELETE]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
