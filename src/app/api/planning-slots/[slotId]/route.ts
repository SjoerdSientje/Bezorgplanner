import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slotId: string }> }
) {
  try {
    const ownerEmail = requireAccountEmail(_req);
    const slotId = (await params).slotId;
    if (!slotId) {
      return NextResponse.json({ error: "Slot-id ontbreekt." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from("planning_slots")
      .delete()
      .eq("owner_email", ownerEmail)
      .eq("id", slotId);
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
