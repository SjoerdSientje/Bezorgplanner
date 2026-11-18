import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { assertOphaalWachtkamerOrder } from "@/lib/ophalen-vervolg";
import { splitVolledigAdres } from "@/lib/adres-fields";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Detail van één ophaalorder in de wachtkamer (voor vervolgformulieren). */
export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const { id } = await ctx.params;
    const order = await assertOphaalWachtkamerOrder(
      createServerSupabaseClient(),
      ownerEmail,
      String(id ?? "").trim()
    );
    const adres = splitVolledigAdres(String(order.volledig_adres ?? ""));
    return NextResponse.json({
      order: {
        ...order,
        straatnaam: adres.straatnaam,
        huisnummer: adres.huisnummer,
        postcode: adres.postcode,
        woonplaats: adres.woonplaats,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Laden mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
