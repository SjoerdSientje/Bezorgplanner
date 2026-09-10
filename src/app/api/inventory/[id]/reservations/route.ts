import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { listReservationsForInventoryProduct } from "@/lib/inventory-reservations";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Reserveringen + werkelijk/gereserveerd/verkoopbaar voor één voorraadregel. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const { id } = await context.params;
    const productId = String(id ?? "").trim();
    if (!productId) {
      return NextResponse.json({ error: "id is verplicht." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const detail = await listReservationsForInventoryProduct(
      supabase,
      ownerEmail,
      productId
    );

    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ophalen mislukt." },
      { status: 500 }
    );
  }
}
