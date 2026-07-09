import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPlanningDate } from "@/lib/planning-date";
import { requireAccountEmail } from "@/lib/account";
import {
  buildRoutificPayloadFromRoutes,
  estimateLegsForRoute,
  getRouteAssignmentMode,
  getRouteLegVehicleKeys,
  orderRouteLoad,
  type OrderForRoute,
  type ParallelRouteSpec,
} from "@/lib/routific-payload";
import { geocodeOrdersForRouting } from "@/lib/pdok-geocode";
import {
  buildRouteOrderListsFromSolution,
  buildRouteSlotsFromRoutificStops,
  getRouteCapacityWarnings,
} from "@/lib/routific-slots";
import { SERVICE_TIME_MINUTES } from "@/lib/routific-payload";
import { supabaseMissingOrdersRouteNummerColumn } from "@/lib/orders-route-nummer-supabase";

const ROUTIFIC_VRP_URL = "https://api.routific.com/v1/vrp-long";
const ROUTIFIC_JOBS_URL = "https://api.routific.com/jobs";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000; // 2 min

/** Leesbare fout uit Routific JSON-body (trial, auth, payload). */
function routificErrorMessage(status: number, errText: string): { error: string; detail: string } {
  const detail = errText.slice(0, 500);
  try {
    const j = JSON.parse(errText) as { error?: string; error_type?: string };
    const type = String(j.error_type ?? "");
    const msg = String(j.error ?? "").trim();
    if (type === "ERR_TRIAL_ENDED" || /trial is over/i.test(msg)) {
      return {
        error:
          "Routific-account: proefperiode/credits zijn op. Upgrade of abonneer in het Routific-dashboard, of gebruik een API-token van een actief betaald account. Een nieuwe token van hetzelfde account helpt niet.",
        detail,
      };
    }
    if (status === 401 || status === 403 || type.includes("AUTH")) {
      return {
        error:
          "Routific-token geweigerd. Controleer ROUTIFIC_API_TOKEN in Vercel (exacte naam), redeploy na wijziging, en of je Production vs Preview de juiste omgeving test.",
        detail,
      };
    }
    if (msg) {
      return { error: `Routific: ${msg}`, detail };
    }
  } catch {
    // geen JSON
  }
  return {
    error: "Routific weigert het verzoek. Controleer token en accountstatus in Routific.",
    detail,
  };
}

/**
 * POST /api/routific/route
 * Body: { parallelRoutes | routes: [{ vertrektijd: "HH:MM", maxFietsen: number }, ...] }
 * Minimaal één route; per route verplicht vertrektijd en max. load (fietsen).
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));
    const prRaw = body.parallelRoutes ?? body.routes;
    if (!Array.isArray(prRaw) || prRaw.length === 0) {
      return NextResponse.json(
        {
          error:
            "Minimaal één route nodig: stuur parallelRoutes (of routes) met per rij vertrektijd (HH:MM) en maxFietsen.",
        },
        { status: 400 }
      );
    }

    const parallelRoutes: ParallelRouteSpec[] = [];
    for (const row of prRaw) {
      const r = row as Record<string, unknown>;
      const ts = String(r.vertrektijd ?? r.shift_start ?? "").trim();
      const capRaw = r.maxFietsen ?? r.capacity;
      const cap = typeof capRaw === "number" ? capRaw : parseInt(String(capRaw ?? ""), 10);
      if (!/^\d{1,2}:\d{2}$/.test(ts)) {
        return NextResponse.json(
          { error: `Ongeldige vertrektijd (gebruik HH:MM): ${ts}` },
          { status: 400 }
        );
      }
      if (!Number.isFinite(cap) || cap < 1 || cap > 99) {
        return NextResponse.json(
          { error: `Ongeldige max. fietsen per route (1–99): ${String(capRaw)}` },
          { status: 400 }
        );
      }
      const meerdereRitten = Boolean(r.meerdereRitten ?? r.meerdere_ritten ?? false);
      const orderIdsRaw = r.orderIds ?? r.order_ids;
      const orderIds = Array.isArray(orderIdsRaw)
        ? orderIdsRaw.map((id) => String(id).trim()).filter(Boolean)
        : undefined;
      parallelRoutes.push({ shift_start: ts, capacity: cap, meerdereRitten, orderIds });
    }

    const vertrektijd = parallelRoutes[0]!.shift_start;

    const token = process.env.ROUTIFIC_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "ROUTIFIC_API_TOKEN niet geconfigureerd." },
        { status: 500 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Zelfde logica als tab "Routes" op ritjes-vandaag: orders met actieve planning_slot
    // horen niet in Routific (handmatige route/planning), wel nog bij Stuur appjes.
    const { data: planningSlots } = await supabase
      .from("planning_slots")
      .select("order_id")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond");
    const routesTabOrderIds = new Set(
      (planningSlots ?? [])
        .map((s: { order_id?: string | null }) => String(s.order_id ?? "").trim())
        .filter(Boolean)
    );

    // Zelfde set als Lijst Sjoerd: alle orders met meenemen_in_planning (niet in Routes-tab).
    // Belangrijk: gefilterde query (owner + status + meenemen), NIET fetchAllOrders() —
    // die haalt de volledige (multi-tenant) orders-tabel op zonder paginering en liep hier
    // stil tegen PostgREST's default max-rows (1000) aan bij >1000 orders totaal, waardoor
    // een deel van de nieuwste/oudste orders — willekeurig welke — nooit in de Routific-
    // batch terechtkwam. Met een serverside WHERE-filter blijft de resultset klein genoeg.
    const { date: planningDate } = getPlanningDate();
    const { data: sjoerdEligibleRaw, error: sjoerdError } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("status", "ritjes_vandaag")
      .eq("meenemen_in_planning", true);
    if (sjoerdError) {
      return NextResponse.json(
        { error: "Orders ophalen mislukt.", detail: sjoerdError.message },
        { status: 500 }
      );
    }
    const sjoerdEligible = (sjoerdEligibleRaw ?? []) as unknown as Record<string, unknown>[];

    const rows = (sjoerdEligible.filter(
      (o) => !routesTabOrderIds.has(String(o.id ?? "").trim())
    ) as unknown) as OrderForRoute[];

    const excludedByActiveSlot = sjoerdEligible.filter((o) =>
      routesTabOrderIds.has(String(o.id ?? "").trim())
    );

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Geen orders gevonden met meenemen_in_planning=true.",
        planningDate,
        vertrektijd,
        visitCount: 0,
        excludedByActiveSlot: excludedByActiveSlot.map((o) => ({
          id: o.id,
          naam: o.naam,
        })),
      });
    }

    const assignmentMode = getRouteAssignmentMode(parallelRoutes, rows.length);
    let rowsForRouting = rows;

    if (assignmentMode !== "auto") {
      const allIds = parallelRoutes.flatMap((r) => r.orderIds ?? []);
      if (allIds.length === 0) {
        rowsForRouting = rows;
      } else if (new Set(allIds).size !== allIds.length) {
        return NextResponse.json(
          { error: "Een order staat op meerdere routes. Elke order mag maar op één route." },
          { status: 400 }
        );
      }
    }

    const rowsGeocoded = await geocodeOrdersForRouting(rowsForRouting);

    const payload = buildRoutificPayloadFromRoutes(rowsGeocoded, parallelRoutes);

    const res = await fetch(ROUTIFIC_VRP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[api/routific/route] Routific POST:", res.status, errText);
      const parsed = routificErrorMessage(res.status, errText);
      return NextResponse.json(
        { error: parsed.error, detail: parsed.detail },
        { status: 502 }
      );
    }

    const { job_id } = (await res.json().catch(() => ({}))) as { job_id?: string };
    if (!job_id) {
      return NextResponse.json(
        { error: "Geen job_id van Routific ontvangen." },
        { status: 502 }
      );
    }

    const output = await pollRoutificJob(token, job_id);
    if (typeof output === "string") {
      return NextResponse.json(
        { error: "Routific meldt een fout.", detail: output },
        { status: 502 }
      );
    }

    const solution = output?.solution as
      | Record<string, Array<{ location_id?: string; arrival_time?: string; finish_time?: string }>>
      | undefined;
    const sanitizeId = (id: string) => id.replace(/[.$]/g, "_");
    const orderByVisitId = new Map<string, OrderForRoute>();
    for (const o of rowsGeocoded) {
      orderByVisitId.set(o.id, o);
      orderByVisitId.set(sanitizeId(o.id), o);
    }

    // Bij "meerdere ritten" bestaat één route uit meerdere voertuigen/legs (vehicle_N,
    // vehicle_N_leg2, ...) — zie routific-payload.ts. Bereken per route hoeveel legs er
    // zijn opgevraagd (zelfde berekening als bij het bouwen van de payload) zodat we de
    // stops van alle legs van diezelfde route achter elkaar kunnen verwerken.
    const legsPerRoute = new Map<number, number>();
    const routeVehicleKeys = new Map<number, string[]>();
    for (let i = 0; i < parallelRoutes.length; i++) {
      const legs = parallelRoutes[i]?.meerdereRitten
        ? estimateLegsForRoute(i, parallelRoutes, rowsGeocoded)
        : 1;
      legsPerRoute.set(i + 1, legs);
      routeVehicleKeys.set(i + 1, getRouteLegVehicleKeys(i, legs));
    }

    const slotsToInsert: {
      order_id: string;
      volgorde: number;
      aankomsttijd: string;
      tijd_opmerking: string;
      rit_nummer: number | null;
      route_nummer: number | null;
    }[] = [];
    let volgorde = 0;

    /** Schrijf order-update; zonder route_nummer-kolom (migratie 014) opnieuw proberen. */
    const patchOrder = async (
      orderId: string,
      payload: { rit_nummer: number | null; route_nummer: number | null; aankomsttijd_slot?: string | null }
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

    const meerDanEenRoute = parallelRoutes.length > 1;
    const ordersById = new Map(rowsGeocoded.map((o) => [o.id, o]));

    // Pins worden nu als hard `type`-constraint aan Routific meegegeven (zie
    // buildRoutificPayloadFromRoutes), dus de solver zelf plaatst gekozen orders op hun
    // route én respecteert daarbij de capaciteit. We vertrouwen daarom direct op Routific's
    // volgorde/tijden — geen naderhand orders verplaatsen of Google Maps herberekenen, dat
    // veroorzaakte eerder "verzonnen" tijdsloten en capaciteitsoverschrijding.
    const { lists: routeOrderLists } = buildRouteOrderListsFromSolution(
      parallelRoutes,
      solution ?? {},
      orderByVisitId,
      routeVehicleKeys
    );

    for (let vi = 0; vi < parallelRoutes.length; vi++) {
      const routeNum = vi + 1;
      const routeNummerDb = meerDanEenRoute ? routeNum : null;

      // Bij "meerdere ritten" de stops van alle legs van deze route (in ritvolgorde) achter
      // elkaar plakken, zodat rit_nummer doorloopt en het één logische route blijft.
      const keys = routeVehicleKeys.get(routeNum) ?? [`vehicle_${routeNum}`];
      const combinedStops = keys.flatMap((k) => solution?.[k] ?? []);

      const built = buildRouteSlotsFromRoutificStops(
        combinedStops,
        orderByVisitId,
        routeNummerDb
      );
      for (const slot of built) {
        volgorde += 1;
        slotsToInsert.push({
          order_id: slot.order_id,
          volgorde,
          aankomsttijd: slot.aankomsttijd,
          tijd_opmerking: slot.arrivalTime,
          rit_nummer: slot.rit_nummer,
          route_nummer: slot.route_nummer,
        });
      }
    }

    if (slotsToInsert.length === 0 && rowsForRouting.length > 0) {
      const unservedRaw = output?.unserved as Record<string, unknown> | null | undefined;
      const unservedIds = unservedRaw ? Object.keys(unservedRaw) : [];
      return NextResponse.json({
        ok: true,
        warning:
          `Routific heeft geen stops ingepland. ${unservedIds.length > 0 ? `${unservedIds.length} order(s) staan als onbereikbaar: ${unservedIds.join(", ")}` : "Controleer adressen in Routific."}`,
        planningDate,
        vertrektijd,
        visitCount: rowsForRouting.length,
        slotsWritten: 0,
        job_id,
        solution: output?.solution ?? null,
        unserved: unservedRaw ?? null,
      });
    }

    // Altijd alle orders in de batch resetten (ook aankomsttijd_slot), zodat geen
    // verouderde tijdsloten van een vorige run zichtbaar blijven voor unserved orders.
    const clearErrors: string[] = [];
    for (const o of rowsForRouting) {
      const err = await patchOrder(o.id, { aankomsttijd_slot: null, rit_nummer: null, route_nummer: null });
      if (err) clearErrors.push(`${o.id}: ${err.message}`);
    }
    if (clearErrors.length > 0) {
      console.error("[api/routific/route] orders reset:", clearErrors.slice(0, 5));
      return NextResponse.json(
        {
          error: "Tijdsloten konden niet worden gewist op orders (database).",
          detail: clearErrors[0],
        },
        { status: 500 }
      );
    }

    if (slotsToInsert.length > 0) {
      const writeErrors: string[] = [];
      for (const s of slotsToInsert) {
        const err = await patchOrder(s.order_id, {
          aankomsttijd_slot: s.aankomsttijd,
          rit_nummer: s.rit_nummer,
          route_nummer: s.route_nummer,
        });
        if (err) writeErrors.push(`${s.order_id}: ${err.message}`);
      }
      if (writeErrors.length > 0) {
        console.error("[api/routific/route] slot writes:", writeErrors.slice(0, 5));
        return NextResponse.json(
          {
            error: "Route berekend maar tijdsloten opslaan in de database is mislukt.",
            detail: writeErrors[0],
          },
          { status: 500 }
        );
      }
    }

    const unserved = output?.unserved as Record<string, string | unknown> | null | undefined;
    const unservedIds = unserved ? Object.keys(unserved) : [];
    const warningParts: string[] = [];

    const servedIds = new Set(slotsToInsert.map((s) => s.order_id));
    const notPlanned = rowsForRouting.filter((o) => !servedIds.has(o.id));
    if (notPlanned.length > 0) {
      const lines = notPlanned.map((o) => `• ${o.naam ?? o.id}`);
      const loadPerRoute = parallelRoutes
        .map((r, i) => {
          const load = (routeOrderLists.get(i + 1) ?? []).reduce(
            (sum, id) => sum + (ordersById.has(id) ? orderRouteLoad(ordersById.get(id)!) : 0),
            0
          );
          const legs = legsPerRoute.get(i + 1) ?? 1;
          const totalCap = r.capacity * legs;
          return `Route ${i + 1}: ${load}/${totalCap} load-eenheden${legs > 1 ? ` (${legs} ritten × ${r.capacity})` : ""} (grote fietsen tellen dubbel)`;
        })
        .join(", ");
      warningParts.push(
        `${notPlanned.length} order(s) niet ingepland — geen capaciteit meer over (${loadPerRoute}):\n${lines.join("\n")}`
      );
    }

    if (unservedIds.length > 0) {
      const lines = unservedIds.map((uid) => {
        const order = orderByVisitId.get(uid) ?? orderByVisitId.get(uid.replace(/[.$]/g, "_"));
        const naam = order?.naam ?? uid;
        const reden = typeof unserved?.[uid] === "string" ? ` (${unserved[uid]})` : "";
        return `• ${naam}${reden}`;
      });
      warningParts.push(`Routific unserved (${unservedIds.length}):\n${lines.join("\n")}`);
    }

    const capacityWarnings = getRouteCapacityWarnings(
      parallelRoutes,
      routeOrderLists,
      ordersById,
      legsPerRoute
    );
    if (capacityWarnings.length > 0) {
      warningParts.push(capacityWarnings.join("\n"));
    }
    const combinedWarning = warningParts.length > 0 ? warningParts.join("\n\n") : undefined;

    return NextResponse.json({
      ok: true,
      message: `Route berekend: ${slotsToInsert.length} van ${rowsForRouting.length} orders ingepland (${SERVICE_TIME_MINUTES} min uitladen per stop).`,
      planningDate,
      vertrektijd,
      visitCount: rows.length,
      slotsWritten: slotsToInsert.length,
      job_id,
      solution: output?.solution ?? null,
      unserved: unserved ?? null,
      warning: combinedWarning,
      excludedByActiveSlot: excludedByActiveSlot.map((o) => ({ id: o.id, naam: o.naam })),
    });
  } catch (e) {
    console.error("[api/routific/route]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function pollRoutificJob(
  token: string,
  jobId: string
): Promise<Record<string, unknown> | string> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(`${ROUTIFIC_JOBS_URL}/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Routific job status failed: ${res.status} ${t}`);
    }
    const data = (await res.json()) as {
      status?: string;
      output?: Record<string, unknown> | string;
    };
    if (data.status === "finished" && data.output != null) {
      return typeof data.output === "string"
        ? data.output
        : (data.output as Record<string, unknown>);
    }
    if (data.status === "error" && data.output != null) {
      return typeof data.output === "string"
        ? data.output
        : JSON.stringify(data.output);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Routific job timeout.");
}
