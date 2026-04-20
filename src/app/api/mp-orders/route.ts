import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { verwerkGarantiebewijs } from "@/lib/garantiebewijs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("source", "mp")
      .neq("status", "ritjes_vandaag");
    if (error) {
      console.error("[mp-orders]", error);
      return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
    }

    const list = (orders ?? []) as Array<Record<string, unknown>>;

    // Safety net: zorg dat elke MP-order in deze lijst een aankoopbewijs-link heeft.
    for (const o of list) {
      const hasLink = String(o.link_aankoopbewijs ?? "").trim() !== "";
      if (hasLink) continue;
      try {
        const link = await verwerkGarantiebewijs(
          {
            order_id: String(o.id ?? ""),
            order_nummer: String(o.order_nummer ?? "") || null,
            naam: String(o.naam ?? "") || null,
            email: String(o.email ?? "") || null,
            producten: String(o.producten ?? "") || null,
            model: String(o.model ?? "") || null,
            serienummer: String(o.serienummer ?? "") || null,
            totaal_prijs:
              o.bestelling_totaal_prijs != null ? Number(o.bestelling_totaal_prijs) : null,
            aantal_fietsen: o.aantal_fietsen != null ? Number(o.aantal_fietsen) : null,
            datum: new Date().toLocaleDateString("nl-NL"),
          },
          supabase as any,
          { skipEmail: true }
        );
        await supabase
          .from("orders")
          .update({ link_aankoopbewijs: link })
          .eq("owner_email", ownerEmail)
          .eq("id", String(o.id ?? ""));
        o.link_aankoopbewijs = link;
      } catch (e) {
        console.error("[mp-orders] aankoopbewijs backfill mislukt voor", o.id, e);
      }
    }

    return NextResponse.json({ orders: list }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[mp-orders]", e);
    return NextResponse.json({ error: "Ophalen mislukt." }, { status: 500 });
  }
}
