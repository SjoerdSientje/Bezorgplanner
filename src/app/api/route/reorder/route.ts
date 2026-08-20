import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";
import {
  departureAfterArrival,
  firstOrderDivergenceIndex,
  parseSlotArrivalHhmm,
  recalculateRouteStops,
  recalculateRouteStopsWithExplicitDepotBreaks,
  type RecalculatedStop,
  type RouteStop,
} from "@/lib/route-recalc";
import { orderRouteLoad, type OrderForRoute } from "@/lib/routific-payload";
import { supabaseMissingOrdersRouteNummerColumn } from "@/lib/orders-route-nummer-supabase";
import { findPausedMpOrderIds } from "@/lib/mp-pause";
import {
  isDepotStopId,
  orderIdLegsFromStopSequence,
  orderIdsFromStopSequence,
} from "@/lib/depot-stops";

type RouteInput = {
  routeNummer: number | null;
  /** Alleen order-UUIDs (afgeleid uit stopIds). */
  orderIds: string[];
  /** Gemengde volgorde: order-UUIDs + depot:… markers. */
  stopIds: string[];
  previousOrderIds: string[];
  vertrektijd: string;
  maxFietsen?: number;
  meerdereRitten?: boolean;
};

type OrderUpdate = {
  id: string;
  route_nummer: number | null;
  rit_nummer: number | null;
  aankomsttijd_slot: string;
  arrivalTime: string;
  leg_nummer?: number | null;
};

/** Vertrektijd voor Overig-herschikking als er geen route 1-vertrektijd bekend is. */
const DEFAULT_VERTREKTIJD_OVERIG = "10:30";

function loadForOrderId(
  id: string,
  orderById: Map<string, Record<string, unknown>>
): number {
  const o = orderById.get(id);
  if (!o) return 0;
  return orderRouteLoad({
    id,
    naam: o.naam ? String(o.naam) : null,
    volledig_adres: String(o.volledig_adres ?? ""),
    aantal_fietsen: o.aantal_fietsen == null ? null : Number(o.aantal_fietsen),
    bezorgtijd_voorkeur: o.bezorgtijd_voorkeur
      ? String(o.bezorgtijd_voorkeur)
      : null,
    producten: o.producten ? String(o.producten) : null,
  } as OrderForRoute);
}

function buildStopsForIds(
  orderIds: string[],
  orderById: Map<string, Record<string, unknown>>
): RouteStop[] {
  return orderIds.map((id) => {
    const o = orderById.get(id)!;
    return {
      id,
      volledig_adres: String(o.volledig_adres ?? ""),
      bezorgtijd_voorkeur: o.bezorgtijd_voorkeur
        ? String(o.bezorgtijd_voorkeur)
        : null,
      load: loadForOrderId(id, orderById),
    };
  });
}

function capacityWarningsForLegs(
  legs: string[][],
  orderById: Map<string, Record<string, unknown>>,
  maxFietsen: number | undefined,
  routeLabel: string
): string[] {
  if (maxFietsen == null || !Number.isFinite(maxFietsen) || maxFietsen < 1) {
    return [];
  }
  const cap = Math.floor(maxFietsen);
  const warnings: string[] = [];
  legs.forEach((leg, idx) => {
    const load = leg.reduce((sum, id) => sum + loadForOrderId(id, orderById), 0);
    if (load > cap) {
      warnings.push(
        `${routeLabel} deel ${idx + 1}: ${load} load > max ${cap} fietsen.`
      );
    }
  });
  return warnings;
}

/**
 * Herberekent alleen vanaf de eerste gewijzigde stop. Ongewijzigde prefix
 * (zelfde order-IDs in dezelfde volgorde) behoudt bestaande tijdsloten.
 */
async function recalculateFromDivergence(
  orderIds: string[],
  previousOrderIds: string[],
  vertrektijd: string,
  orderById: Map<string, Record<string, unknown>>
): Promise<RecalculatedStop[]> {
  const stops: RouteStop[] = orderIds.map((id) => {
    const o = orderById.get(id)!;
    return {
      id,
      volledig_adres: String(o.volledig_adres ?? ""),
      bezorgtijd_voorkeur: o.bezorgtijd_voorkeur ? String(o.bezorgtijd_voorkeur) : null,
    };
  });

  const divergeAt = firstOrderDivergenceIndex(previousOrderIds, orderIds);
  if (divergeAt <= 0 || divergeAt >= orderIds.length) {
    if (divergeAt >= orderIds.length) return [];
    return recalculateRouteStops(stops, vertrektijd);
  }

  const prefixLastId = orderIds[divergeAt - 1]!;
  const prefixLast = orderById.get(prefixLastId);
  const arrival = parseSlotArrivalHhmm(
    prefixLast ? String(prefixLast.aankomsttijd_slot ?? "") : null
  );
  const fromAddress = String(prefixLast?.volledig_adres ?? "").trim();
  if (!arrival || !fromAddress) {
    return recalculateRouteStops(stops, vertrektijd);
  }

  const suffix = stops.slice(divergeAt);
  const departFromPrefix = departureAfterArrival(arrival);
  return recalculateRouteStops(suffix, departFromPrefix, { fromAddress });
}

async function recalculateRouteWithOptionalDepotMarkers(
  route: RouteInput,
  orderById: Map<string, Record<string, unknown>>,
  routeLabel: string
): Promise<{
  recalculated: RecalculatedStop[];
  packWithDepot: boolean;
  warnings: string[];
}> {
  const stopIds =
    route.stopIds.length > 0 ? route.stopIds : route.orderIds;
  const hasDepotMarkers = stopIds.some((id) => isDepotStopId(id));
  const orderLegs = orderIdLegsFromStopSequence(stopIds);
  const warnings = capacityWarningsForLegs(
    orderLegs,
    orderById,
    route.maxFietsen,
    routeLabel
  );

  const hadMultiLeg = route.orderIds.some((id) => {
    const n = Number(orderById.get(id)?.leg_nummer ?? 1);
    return Number.isFinite(n) && n > 1;
  });

  if (hasDepotMarkers && orderLegs.length > 0) {
    const legs = orderLegs.map((ids) => buildStopsForIds(ids, orderById));
    const depotResult = await recalculateRouteStopsWithExplicitDepotBreaks(
      legs,
      route.vertrektijd
    );
    return {
      recalculated: depotResult.stops,
      packWithDepot: orderLegs.length > 1,
      warnings,
    };
  }

  // Alle depot-markers weg → hele route als één deel (wis oude leg_nummer).
  if (hadMultiLeg) {
    const stops = buildStopsForIds(route.orderIds, orderById);
    const recalculated = await recalculateRouteStops(stops, route.vertrektijd);
    return { recalculated, packWithDepot: false, warnings };
  }

  const recalculated = await recalculateFromDivergence(
    route.orderIds,
    route.previousOrderIds,
    route.vertrektijd,
    orderById
  );
  return { recalculated, packWithDepot: false, warnings };
}

/**
 * POST /api/route/reorder
 * Body: { routes: [{ routeNummer, orderIds, previousOrderIds?, vertrektijd }, ...] }
 *
 * Herberekent tijdsloten via Google Maps (reistijd + 20 min uitladen per stop).
 * Alleen stops vanaf de eerste wijziging in volgorde worden herberekend.
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
      const stopIdsRaw = r.stopIds ?? r.stop_ids ?? r.orderIds ?? r.order_ids;
      const stopIdsAll = Array.isArray(stopIdsRaw)
        ? stopIdsRaw.map((id: unknown) => String(id).trim()).filter(Boolean)
        : [];
      const stopIds = stopIdsAll;
      const orderIds = orderIdsFromStopSequence(stopIds);
      const previousRaw = r.previousOrderIds ?? r.previous_order_ids;
      const previousAll = Array.isArray(previousRaw)
        ? previousRaw.map((id: unknown) => String(id).trim()).filter(Boolean)
        : [];
      const previousOrderIds = orderIdsFromStopSequence(previousAll);
      const vertrektijd = String(r.vertrektijd ?? "").trim();
      if (
        routeNummer != null &&
        !/^\d{1,2}:\d{2}$/.test(vertrektijd)
      ) {
        return NextResponse.json(
          { error: `Ongeldige vertrektijd voor route ${routeNummer} (gebruik HH:MM).` },
          { status: 400 }
        );
      }
      const maxFietsenRaw = r.maxFietsen ?? r.max_fietsen;
      const maxFietsen =
        maxFietsenRaw == null || maxFietsenRaw === ""
          ? undefined
          : Number(maxFietsenRaw);
      const meerdereRitten = Boolean(r.meerdereRitten ?? r.meerdere_ritten ?? false);
      routes.push({
        routeNummer,
        orderIds,
        stopIds,
        previousOrderIds,
        vertrektijd,
        maxFietsen:
          maxFietsen != null && Number.isFinite(maxFietsen) ? maxFietsen : undefined,
        meerdereRitten,
      });
    }

    const allIdsRaw = routes.flatMap((r) => r.orderIds);
    if (allIdsRaw.length === 0) {
      return NextResponse.json({ error: "Geen orders om te herberekenen." }, { status: 400 });
    }
    if (new Set(allIdsRaw).size !== allIdsRaw.length) {
      return NextResponse.json(
        { error: "Een order staat op meerdere routes." },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // MP-pauzeknop: nog-niet-afgeronde MP-orders overal negeren, ook als de client
    // (buiten de normale UI om) toch een id meestuurt.
    const pausedMpOrderIds = await findPausedMpOrderIds(supabase, ownerEmail, allIdsRaw);
    for (const route of routes) {
      route.orderIds = route.orderIds.filter((id) => !pausedMpOrderIds.has(id));
      route.previousOrderIds = route.previousOrderIds.filter(
        (id) => !pausedMpOrderIds.has(id)
      );
      route.stopIds = route.stopIds.filter(
        (id) => isDepotStopId(id) || !pausedMpOrderIds.has(id)
      );
    }
    const allIds = allIdsRaw.filter((id) => !pausedMpOrderIds.has(id));
    if (allIds.length === 0) {
      return NextResponse.json({ error: "Geen orders om te herberekenen." }, { status: 400 });
    }
    const { data: ordersData, error: ordersErr } = await supabase
      .from("orders")
      .select(
        "id, volledig_adres, bezorgtijd_voorkeur, naam, route_nummer, rit_nummer, aankomsttijd_slot, aantal_fietsen, producten, leg_nummer"
      )
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
    const capacityWarnings: string[] = [];

    const patchOrder = async (
      orderId: string,
      payload: {
        route_nummer: number | null;
        rit_nummer: number | null;
        aankomsttijd_slot: string | null;
        leg_nummer?: number | null;
      }
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
      if (error && /leg_nummer/i.test(error.message ?? "")) {
        const { leg_nummer: _l, ...rest } = payload;
        const r3 = await supabase.from("orders").update(rest).eq("owner_email", ownerEmail).eq("id", orderId);
        error = r3.error;
      }
      return error;
    };

    // Alle "Overig"-route-entries (routeNummer null) bundelen tot ÉÉN batch met ÉÉN
    // vertrektijd, ook als de client per ongeluk meerdere aparte entries stuurt.
    const overigStopIds: string[] = [];
    let overigPreviousOrderIds: string[] = [];
    let overigVertrektijd: string | null = null;
    let overigMaxFietsen: number | undefined;
    let overigMeerdereRitten = false;
    const realRoutes: RouteInput[] = [];
    for (const route of routes) {
      if (route.orderIds.length === 0 && !route.stopIds.some(isDepotStopId)) continue;
      if (route.routeNummer == null) {
        for (const id of route.stopIds) {
          if (!overigStopIds.includes(id)) overigStopIds.push(id);
        }
        if (overigPreviousOrderIds.length === 0 && route.previousOrderIds.length > 0) {
          overigPreviousOrderIds = route.previousOrderIds;
        }
        if (!overigVertrektijd && /^\d{1,2}:\d{2}$/.test(route.vertrektijd)) {
          overigVertrektijd = route.vertrektijd;
        }
        if (route.maxFietsen != null && Number.isFinite(route.maxFietsen)) {
          overigMaxFietsen = Number(route.maxFietsen);
        }
        if (route.meerdereRitten) overigMeerdereRitten = true;
      } else {
        realRoutes.push(route);
      }
    }

    const overigOrderIds = orderIdsFromStopSequence(overigStopIds);

    if (overigOrderIds.length > 0) {
      const toUnplan: string[] = [];
      const toRecalc: string[] = [];
      for (const id of overigOrderIds) {
        const current = orderById.get(id) as Record<string, unknown> | undefined;
        const currentlyOnRoute = current?.route_nummer != null && Number(current.route_nummer) > 0;
        (currentlyOnRoute ? toUnplan : toRecalc).push(id);
      }

      for (const id of toUnplan) {
        const err = await patchOrder(id, {
          route_nummer: null,
          rit_nummer: null,
          aankomsttijd_slot: null,
          leg_nummer: null,
        });
        if (err) {
          console.error("[route/reorder] unplan:", err);
          return NextResponse.json(
            { error: "Order uit route halen mislukt.", detail: err.message },
            { status: 500 }
          );
        }
        await supabase
          .from("planning_slots")
          .delete()
          .eq("owner_email", ownerEmail)
          .eq("order_id", id);
      }

      if (toRecalc.length > 0) {
        const rawVt = overigVertrektijd ?? DEFAULT_VERTREKTIJD_OVERIG;
        const [vh] = rawVt.split(":").map((x) => parseInt(x, 10));
        const vertrektijd =
          Number.isFinite(vh) && vh >= 0 && vh < 6
            ? DEFAULT_VERTREKTIJD_OVERIG
            : rawVt;

        // Alleen orders die in Overig blijven; depot-markers tussen die orders behouden.
        const toRecalcSet = new Set(toRecalc);
        const stopIdsForRecalc = overigStopIds.filter(
          (id) => isDepotStopId(id) || toRecalcSet.has(id)
        );

        const { recalculated, packWithDepot, warnings } =
          await recalculateRouteWithOptionalDepotMarkers(
            {
              routeNummer: null,
              orderIds: toRecalc,
              stopIds: stopIdsForRecalc,
              previousOrderIds: overigPreviousOrderIds,
              vertrektijd,
              maxFietsen: overigMaxFietsen,
              meerdereRitten: overigMeerdereRitten,
            },
            orderById,
            "Overig"
          );
        capacityWarnings.push(...warnings);

        const recalculatedById = new Map(recalculated.map((s) => [s.id, s]));
        const maxLeg = Math.max(
          1,
          ...recalculated.map((s) => Number(s.leg_nummer ?? 1)),
          1
        );

        for (let i = 0; i < toRecalc.length; i++) {
          const id = toRecalc[i]!;
          const ritNummer = i + 1;
          const recalc = recalculatedById.get(id);
          if (recalc) {
            updates.push({
              id,
              route_nummer: null,
              rit_nummer: ritNummer,
              aankomsttijd_slot: recalc.aankomsttijd_slot,
              arrivalTime: recalc.arrivalTime,
              leg_nummer: packWithDepot
                ? maxLeg > 1
                  ? (recalc.leg_nummer ?? 1)
                  : null
                : null,
            });
            continue;
          }
          const existing = orderById.get(id);
          const existingSlot = String(existing?.aankomsttijd_slot ?? "").trim();
          if (!existingSlot) continue;
          const existingRit = Number(existing?.rit_nummer ?? 0);
          if (existingRit !== ritNummer || existing?.rit_nummer == null) {
            updates.push({
              id,
              route_nummer: null,
              rit_nummer: ritNummer,
              aankomsttijd_slot: existingSlot,
              arrivalTime: parseSlotArrivalHhmm(existingSlot) ?? "",
              leg_nummer:
                existing?.leg_nummer != null ? Number(existing.leg_nummer) : null,
            });
          }
        }
      }
    }

    for (const route of realRoutes) {
      const routeNummerDb =
        route.routeNummer != null && Number.isFinite(route.routeNummer) && route.routeNummer > 0
          ? route.routeNummer
          : null;

      const { recalculated, packWithDepot, warnings } =
        await recalculateRouteWithOptionalDepotMarkers(
          route,
          orderById,
          routeNummerDb != null ? `Route ${routeNummerDb}` : "Route"
        );
      capacityWarnings.push(...warnings);

      const recalculatedById = new Map(recalculated.map((s) => [s.id, s]));
      const maxLeg = Math.max(
        1,
        ...recalculated.map((s) => Number(s.leg_nummer ?? 1)),
        1
      );

      for (let i = 0; i < route.orderIds.length; i++) {
        const id = route.orderIds[i]!;
        const ritNummer = i + 1;
        const recalc = recalculatedById.get(id);
        if (recalc) {
          updates.push({
            id,
            route_nummer: routeNummerDb,
            rit_nummer: ritNummer,
            aankomsttijd_slot: recalc.aankomsttijd_slot,
            arrivalTime: recalc.arrivalTime,
            leg_nummer: packWithDepot
              ? maxLeg > 1
                ? (recalc.leg_nummer ?? 1)
                : null
              : null,
          });
          continue;
        }
        if (packWithDepot) continue;
        const existing = orderById.get(id);
        const existingSlot = String(existing?.aankomsttijd_slot ?? "").trim();
        const existingRit = Number(existing?.rit_nummer ?? 0);
        const existingRoute = existing?.route_nummer != null ? Number(existing.route_nummer) : null;
        if (
          existingSlot &&
          (existingRit !== ritNummer || existingRoute !== routeNummerDb)
        ) {
          updates.push({
            id,
            route_nummer: routeNummerDb,
            rit_nummer: ritNummer,
            aankomsttijd_slot: existingSlot,
            arrivalTime: parseSlotArrivalHhmm(existingSlot) ?? "",
            leg_nummer: existing?.leg_nummer != null ? Number(existing.leg_nummer) : null,
          });
        }
      }
    }

    for (const u of updates) {
      const err = await patchOrder(u.id, {
        route_nummer: u.route_nummer,
        rit_nummer: u.rit_nummer,
        aankomsttijd_slot: u.aankomsttijd_slot,
        leg_nummer: u.leg_nummer ?? null,
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

    // Sync volgorde in planning_slots per route (niet voor Overig)
    for (const route of routes) {
      if (route.orderIds.length === 0 || route.routeNummer == null) continue;
      for (let i = 0; i < route.orderIds.length; i++) {
        await supabase
          .from("planning_slots")
          .update({ volgorde: i + 1 })
          .eq("owner_email", ownerEmail)
          .eq("order_id", route.orderIds[i]!);
      }
    }

    const changedSlotCount = updates.filter((u) => {
      const prev = String(orderById.get(u.id)?.aankomsttijd_slot ?? "").trim();
      return prev !== u.aankomsttijd_slot;
    }).length;

    return NextResponse.json({
      ok: true,
      message: `${changedSlotCount} tijdsloten herberekend via Google Maps.`,
      warnings: capacityWarnings.length > 0 ? capacityWarnings : undefined,
      updates: updates.map((u) => ({
        id: u.id,
        route_nummer: u.route_nummer,
        rit_nummer: u.rit_nummer,
        aankomsttijd_slot: u.aankomsttijd_slot,
        leg_nummer: u.leg_nummer ?? null,
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
