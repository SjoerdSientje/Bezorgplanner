import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  countInventoryPendingProducts,
  listInventoryPendingProducts,
} from "@/lib/inventory-pending";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const supabase = createServerSupabaseClient();

    const [products, count] = await Promise.all([
      listInventoryPendingProducts(supabase, ownerEmail),
      countInventoryPendingProducts(supabase, ownerEmail),
    ]);

    return NextResponse.json(
      { products, count },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ophalen mislukt." },
      { status: 500 }
    );
  }
}
