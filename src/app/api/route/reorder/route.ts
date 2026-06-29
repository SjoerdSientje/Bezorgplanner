import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";
import { recalculateRouteStops } from "@/lib/route-recalc";
import { supabaseMissingOrdersRouteNummerColumn } from "@/lib/orders-route-nummer-supabase";

type RouteInput = {
  routeNummer: number | null;
  orderIds: string[];
  vertrektijd: string;
};

type OrderUpdate = {
  id: string;
  route_nummer: number | null;
  rit_nummer: number;
  aankomsttijd_slot: string;
  arrivalTime: string;
};

/**
 * POST /api/route/reorder
 * Body: { routes: [{ routeNummer, orderIds, vertrektijd }, ...] }
 *
 * Herberekent tijdsloten via Google Maps (reistijd + 20 min uitladen per stop).
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
    const routesRaw = body.routes;
    if (!Array.isArray(routesRaw) || routesRaw.length === 0) {
      return NextResponse.json(
        { error: "Stuur routes met routeNummer, orderIds en vertrektijd." },
        { status: 400 }
      );
    }

    const routes: RouteInput[] = [];
    for (const row of routesRaw) {
      const r = row as Record<string, unknown>;
      const routeNummerRaw = r.routeNummer ?? r.route_nummer;
      const routeNummer =
        routeNummerRaw == null || routeNummerRaw === ""
          ? null
          : Number(routeNummerRaw);
      const orderIdsRaw = r.orderIds ?? r.order_ids;
      const orderIds = Array.isArray(orderIdsRaw)
        ? orderIdsRaw.map((id: unknown) => String(id).trim()).filter(Boolean)
        : [];
      const vertrektijd = String(r.vertrektijd ?? "").trim();
      if (!/^\d{1,2}:\d{2}$/.test(vertrektijd)) {
        return NextResponse.json(
          { error: `Ongeldige vertrektijd voor route ${routeNummer ?? "?"} (gebruik HH:MM).` },
          { status: 400 }
        );
      }
      routes.push({ routeNummer, orderIds, vertrektijd });
    }

    const allIds = routes.flatMap((r) => r.orderIds);
    if (allIds.length === 0) {
      return NextResponse.json({ error: "Geen orders om te herberekenen." }, { status: 400 });
    }
    if (new Set(allIds).size !== allIds.length) {
      return NextResponse.json(
        { error: "Een order staat op meerdere routes." },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: ordersData, error: ordersErr } = await supabase
      .from("orders")
      .select("id, volledig_adres, bezorgtijd_voorkeur, naam")
      .eq("owner_email", ownerEmail)
      .in("id", allIds);

    if (ordersErr) {
      console.error("[route/reorder] orders:", ordersErr);
      return NextResponse.json({ error: "Orders ophalen mislukt." }, { status: 500 });
    }

    const orderById = new Map(
      (ordersData ?? []).map((o: Record<string, unknown>) => [String(o.id), o])
    );
    for (const id of allIds) {
      if (!orderById.has(id)) {
        return NextResponse.json({ error: `Order niet gevonden: ${id}` }, { status: 400 });
      }
    }

    const updates: OrderUpdate[] = [];

    for (const route of routes) {
      if (route.orderIds.length === 0) continue;

      const stops = route.orderIds.map((id) => {
        const o = orderById.get(id)! as Record<string, unknown>;
        return {
          id,
          volledig_adres: String(o.volledig_adres ?? ""),
          bezorgtijd_voorkeur: o.bezorgtijd_voorkeur
            ? String(o.bezorgtijd_voorkeur)
            : null,
        };
      });

      const recalculated = await recalculateRouteStops(stops, route.vertrektijd);
      const routeNummerDb =
        route.routeNummer != null && Number.isFinite(route.routeNummer) && route.routeNummer > 0
          ? route.routeNummer
          : null;

      for (let i = 0; i < recalculated.length; i++) {
        const stop = recalculated[i]!;
        updates.push({
          id: stop.id,
          route_nummer: routeNummerDb,
          rit_nummer: i + 1,
          aankomsttijd_slot: stop.aankomsttijd_slot,
          arrivalTime: stop.arrivalTime,
        });
      }
    }

    const patchOrder = async (
      orderId: string,
      payload: { route_nummer: number | null; rit_nummer: number; aankomsttijd_slot: string }
    ) => {
      let { error } = await supabase
        .from("orders")
        .update(payload)
        .eq("owner_email", ownerEmail)
        .eq("id", orderId);
      if (error && supabaseMissingOrdersRouteNummerColumn(error) && "route_nummer" in payload) {
        const { route_nummer: _r, ...rest } = payload;
        const r2 = await supabase.from("orders").update(rest).eq("owner_email", ownerEmail).eq("id", orderId);
        error = r2.error;
      }
      return error;
    };

    for (const u of updates) {
      const err = await patchOrder(u.id, {
        route_nummer: u.route_nummer,
        rit_nummer: u.rit_nummer,
        aankomsttijd_slot: u.aankomsttijd_slot,
      });
      if (err) {
        console.error("[route/reorder] patch order:", err);
        return NextResponse.json(
          { error: "Tijdsloten opslaan mislukt.", detail: err.message },
          { status: 500 }
        );
      }

      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: u.aankomsttijd_slot })
        .eq("owner_email", ownerEmail)
        .eq("order_id", u.id);
    }

    // Sync volgorde in planning_slots per route
    for (const route of routes) {
      if (route.orderIds.length === 0) continue;
      for (let i = 0; i < route.orderIds.length; i++) {
        await supabase
          .from("planning_slots")
          .update({ volgorde: i + 1 })
          .eq("owner_email", ownerEmail)
          .eq("order_id", route.orderIds[i]!);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `${updates.length} tijdsloten herberekend via Google Maps.`,
      updates: updates.map((u) => ({
        id: u.id,
        route_nummer: u.route_nummer,
        aankomsttijd_slot: u.aankomsttijd_slot,
      })),
    });
  } catch (e) {
    console.error("[api/route/reorder]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
