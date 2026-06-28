import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { applyInventoryMutation } from "@/lib/inventory";

export const dynamic = "force-dynamic";

type ScanItem = {
  productId: string;
  quantity: number;
};

export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));

    const direction = body.direction as "inkomend" | "uitgaand";
    const items = Array.isArray(body.items) ? (body.items as ScanItem[]) : [];
    const note = body.note != null ? String(body.note) : null;

    if (direction !== "inkomend" && direction !== "uitgaand") {
      return NextResponse.json({ error: "Kies inkomend of uitgaand." }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "Geen producten geselecteerd." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const results: { productId: string; stockAfter: number }[] = [];

    for (const item of items) {
      const productId = String(item.productId ?? "").trim();
      const quantity = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
      if (!productId) continue;

      const result = await applyInventoryMutation(supabase, {
        ownerEmail,
        productId,
        mutationType: direction,
        quantity,
        source: "winkel",
        note,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error, productId }, { status: 400 });
      }

      results.push({ productId, stockAfter: result.stockAfter });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Scan-mutatie mislukt." },
      { status: 500 }
    );
  }
}
