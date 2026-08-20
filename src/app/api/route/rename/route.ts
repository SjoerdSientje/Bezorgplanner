import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";
import { supabaseMissingOrdersRouteNummerColumn } from "@/lib/orders-route-nummer-supabase";

/**
 * POST /api/route/rename
 * Body: { routeNummer: number, naam: string }
 *
 * Zet orders.route_naam voor alle orders van deze route (zelfde owner).
 * Planning leest route_naam live uit orders → labels daar volgen automatisch.
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase niet geconfigureerd." }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const routeNummer = Number(body.routeNummer ?? body.route_nummer);
    if (!Number.isFinite(routeNummer) || routeNummer < 1) {
      return NextResponse.json(
        { error: "Ongeldig routeNummer (gebruik 1, 2, …)." },
        { status: 400 }
      );
    }

    const naam = String(body.naam ?? "").trim() || `Route ${routeNummer}`;
    const supabase = createClient(supabaseUrl, serviceKey);

    let { data, error } = await supabase
      .from("orders")
      .update({ route_naam: naam })
      .eq("owner_email", ownerEmail)
      .eq("route_nummer", routeNummer)
      .select("id");

    if (error && supabaseMissingOrdersRouteNummerColumn(error)) {
      return NextResponse.json(
        {
          error:
            "Kolom route_naam/route_nummer ontbreekt. Draai migratie 023_route_naam.sql.",
        },
        { status: 500 }
      );
    }
    if (error) {
      console.error("[api/route/rename]", error);
      return NextResponse.json(
        { error: "Routenaam opslaan mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    const updatedIds = (data ?? []).map((r: { id: string }) => String(r.id));
    return NextResponse.json({
      ok: true,
      routeNummer,
      naam,
      updatedCount: updatedIds.length,
      updatedIds,
    });
  } catch (e) {
    console.error("[api/route/rename]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
