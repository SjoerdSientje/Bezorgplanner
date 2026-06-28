import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { applyInventoryMutation, type InventoryMutationType } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));

    const productId = String(body.productId ?? "").trim();
    const mutationType = body.mutationType as InventoryMutationType;
    const quantity = Number(body.quantity);
    const note = body.note != null ? String(body.note) : null;

    if (!productId) {
      return NextResponse.json({ error: "productId is verplicht." }, { status: 400 });
    }
    if (!["inkomend", "uitgaand", "correctie"].includes(mutationType)) {
      return NextResponse.json({ error: "Ongeldig mutatietype." }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Ongeldig aantal." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const result = await applyInventoryMutation(supabase, {
      ownerEmail,
      productId,
      mutationType,
      quantity,
      source: "handmatig",
      note,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, stockAfter: result.stockAfter });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Mutatie mislukt." },
      { status: 500 }
    );
  }
}
