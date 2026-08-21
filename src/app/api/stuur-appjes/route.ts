import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";
import { requireAccountEmail } from "@/lib/account";
import { getLatestOrNewPlanningDate } from "@/lib/planning-promote";
import { getPlanningDate } from "@/lib/planning-date";
import { isStuurAppjesEligibleOrder } from "@/lib/stuur-appjes-eligibility";
import { isIncompleteMpOrder, isMpPausedForOwner } from "@/lib/mp-pause";
import {
  resequencePlanningSlotsByTijdslot,
  resequenceRouteOrdersByTijdslot,
  type ResequencedOrder,
} from "@/lib/route-resequence";
import { supabaseMissingOrdersRouteNummerColumn } from "@/lib/orders-route-nummer-supabase";
import { routeDisplayLabel } from "@/lib/route-colors";

function mergeSlotDatums(rows: Array<{ order_id: string | null; datum: string | null }>) {
  const m = new Map<string, string>();
  for (const r of rows) {
    const id = String(r.order_id ?? "");
    const d = String(r.datum ?? "").trim();
    if (!id || !d) continue;
    const prev = m.get(id);
    if (!prev || d > prev) m.set(id, d);
  }
  return m;
}

function parseRouteNummer(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "" || raw === "overig") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

async function patchOrderRouteAndSlot(
  supabase: any,
  ownerEmail: string,
  orderId: string,
  payload: {
    route_nummer: number | null;
    aankomsttijd_slot: string;
    route_naam?: string | null;
  }
) {
  let { error } = await supabase
    .from("orders")
    .update(payload)
    .eq("owner_email", ownerEmail)
    .eq("id", orderId);
  if (error && supabaseMissingOrdersRouteNummerColumn(error)) {
    const { route_nummer: _r, route_naam: _n, ...rest } = payload;
    const r2 = await supabase
      .from("orders")
      .update(rest)
      .eq("owner_email", ownerEmail)
      .eq("id", orderId);
    error = r2.error;
  }
  return error;
}

/**
 * POST /api/stuur-appjes
 * Body: { orders: Array<{ …; section; route_nummer?: number | null }> }
 *
 * - "nieuw_tijdslot": sync tijdslot + herorden route op tijdslot.
 * - "nieuwe_order": kies route (of overig), planning-slot, herorden op tijdslot.
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const selected = (body.orders ?? []) as Array<{
      order_id: string;
      order_nummer: string;
      naam: string;
      aankomsttijd_slot: string;
      telefoon_e164: string;
      telefoon_nummer: string;
      bezorgtijd_voorkeur?: string;
      section: "nieuwe_order" | "nieuw_tijdslot";
      /** Alleen nieuwe_order: null = Overig. Verplicht aanwezig (ook als null). */
      route_nummer?: number | null;
    }>;

    if (selected.length === 0) {
      return NextResponse.json({ error: "Geen orders geselecteerd." }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const mpPaused = await isMpPausedForOwner(supabase, ownerEmail);

    const { data: ordersMeta } = await supabase
      .from("orders")
      .select(
        "id, status, source, order_nummer, type, betaald, mp_tags, datum, opmerkingen_klant, bezorgtijd_voorkeur, bestelling_totaal_prijs, meenemen_in_planning, aankomsttijd_slot, route_nummer, route_naam, rit_nummer"
      )
      .eq("owner_email", ownerEmail)
      .in(
        "id",
        selected.map((o) => o.order_id)
      );
    const metaById = new Map(
      (ordersMeta ?? []).map((o: Record<string, unknown>) => [String(o.id), o])
    );

    const ineligible = selected.filter((o) => {
      const meta = metaById.get(o.order_id) as Record<string, unknown> | undefined;
      if (!meta || !isStuurAppjesEligibleOrder(meta)) return true;
      if (mpPaused && isIncompleteMpOrder(meta)) return true;
      return false;
    });
    if (ineligible.length > 0) {
      const nums = ineligible.map((o) => o.order_nummer || o.order_id).join(", ");
      return NextResponse.json(
        {
          error: `Deze orders zijn niet geschikt voor appjes (geen meenemen in planning of geen geldig tijdslot): ${nums}`,
        },
        { status: 400 }
      );
    }

    const missingRoute = selected.filter(
      (o) => o.section === "nieuwe_order" && !("route_nummer" in o)
    );
    if (missingRoute.length > 0) {
      return NextResponse.json(
        {
          error:
            "Kies voor elke nieuwe order een route (of Overig) voordat je appjes stuurt.",
        },
        { status: 400 }
      );
    }

    const routesToResequence = new Set<string>();
    const markRoute = (rn: number | null) => {
      routesToResequence.add(rn == null || rn < 1 ? "overig" : String(rn));
    };
    const planningDatumsToResequence = new Set<string>();
    const orderUpdates: ResequencedOrder[] = [];

    for (const o of selected.filter((x) => x.section === "nieuw_tijdslot")) {
      if (!o.aankomsttijd_slot) continue;
      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: o.aankomsttijd_slot })
        .eq("owner_email", ownerEmail)
        .eq("order_id", o.order_id);

      await supabase
        .from("orders")
        .update({ aankomsttijd_slot: o.aankomsttijd_slot })
        .eq("owner_email", ownerEmail)
        .eq("id", o.order_id);

      const meta = metaById.get(o.order_id);
      markRoute(parseRouteNummer(meta?.route_nummer));
    }

    const nieuweOrderOrders = selected.filter((o) => o.section === "nieuwe_order");
    let planningDatumVoorNieuweOrders: string | null = null;
    let nieuweOrderIsMorgen = false;
    if (nieuweOrderOrders.length > 0) {
      const { date, isTomorrow } = getPlanningDate();
      planningDatumVoorNieuweOrders = date;
      nieuweOrderIsMorgen = isTomorrow;
      const targetDate = planningDatumVoorNieuweOrders;
      planningDatumsToResequence.add(targetDate);

      const { data: nameRows } = await supabase
        .from("orders")
        .select("route_nummer, route_naam")
        .eq("owner_email", ownerEmail)
        .not("route_nummer", "is", null);
      const naamByRoute = new Map<number, string>();
      for (const r of (nameRows ?? []) as Record<string, unknown>[]) {
        const rn = Number(r.route_nummer ?? 0);
        const nm = String(r.route_naam ?? "").trim();
        if (rn > 0 && nm && !naamByRoute.has(rn)) naamByRoute.set(rn, nm);
      }

      await supabase
        .from("planning_slots")
        .delete()
        .eq("owner_email", ownerEmail)
        .eq("datum", targetDate)
        .in(
          "order_id",
          nieuweOrderOrders.map((o) => o.order_id)
        );

      for (const o of nieuweOrderOrders) {
        const rn = parseRouteNummer(o.route_nummer);
        markRoute(rn);
        const routeNaam =
          rn != null ? (naamByRoute.get(rn) ?? routeDisplayLabel(rn, null)) : null;
        const err = await patchOrderRouteAndSlot(supabase, ownerEmail, o.order_id, {
          route_nummer: rn,
          aankomsttijd_slot: o.aankomsttijd_slot,
          route_naam: routeNaam,
        });
        if (err) console.error("[api/stuur-appjes] order route patch:", err);
      }

      const slotsToInsert = nieuweOrderOrders.map((o, i) => ({
        owner_email: ownerEmail,
        datum: targetDate,
        order_id: o.order_id,
        volgorde: 9000 + i,
        aankomsttijd: o.aankomsttijd_slot,
        tijd_opmerking: String(
          (metaById.get(o.order_id) as Record<string, unknown> | undefined)
            ?.bezorgtijd_voorkeur ??
            o.bezorgtijd_voorkeur ??
            ""
        ),
      }));

      const { error: insertErr } = await supabase
        .from("planning_slots")
        .insert(slotsToInsert);
      if (insertErr) console.error("[api/stuur-appjes] planning insert:", insertErr);
    }

    const tijdslotOrderIds = Array.from(
      new Set(selected.filter((o) => o.section === "nieuw_tijdslot").map((o) => o.order_id))
    );
    let slotDatumByOrderId = new Map<string, string>();
    if (tijdslotOrderIds.length > 0) {
      const { data: slotRows } = await supabase
        .from("planning_slots")
        .select("order_id, datum")
        .eq("owner_email", ownerEmail)
        .in("order_id", tijdslotOrderIds)
        .neq("status", "afgerond");
      slotDatumByOrderId = mergeSlotDatums(
        (slotRows ?? []) as Array<{ order_id: string | null; datum: string | null }>
      );
      for (const d of Array.from(slotDatumByOrderId.values())) {
        if (d) planningDatumsToResequence.add(d);
      }
    }

    for (const key of Array.from(routesToResequence)) {
      const rn = key === "overig" ? null : Number(key);
      const updated = await resequenceRouteOrdersByTijdslot(
        supabase as any,
        ownerEmail,
        rn == null || !Number.isFinite(rn) ? null : rn
      );
      for (const u of updated) {
        const prev = orderUpdates.findIndex((x) => x.id === u.id);
        if (prev >= 0) orderUpdates[prev] = u;
        else orderUpdates.push(u);
      }
    }

    for (const datum of Array.from(planningDatumsToResequence)) {
      await resequencePlanningSlotsByTijdslot(supabase as any, ownerEmail, datum);
    }

    const mistSlotDatumVoorTijdslot = selected.some(
      (o) => o.section === "nieuw_tijdslot" && !slotDatumByOrderId.get(o.order_id)
    );
    const fallbackPlanningDatum = mistSlotDatumVoorTijdslot
      ? await getLatestOrNewPlanningDate(ownerEmail, supabase as any)
      : "";

    const details: string[] = [];
    let sentCount = 0;
    let failCount = 0;

    for (const o of selected) {
      const meta = (metaById.get(o.order_id) ?? {}) as Record<string, unknown>;
      const inPlanningEnRitjesVandaag = o.section === "nieuw_tijdslot";

      const templatePlandatum =
        o.section === "nieuwe_order"
          ? (planningDatumVoorNieuweOrders ?? "")
          : slotDatumByOrderId.get(o.order_id) || fallbackPlanningDatum;

      const sendRes = await sendWhatsAppByEvent(
        "stuur_appjes",
        {
          order_nummer: o.order_nummer,
          naam: o.naam,
          aankomsttijd_slot: o.aankomsttijd_slot,
          bestelling_totaal_prijs: (meta.bestelling_totaal_prijs as number | null) ?? null,
          telefoon_e164: o.telefoon_e164,
          telefoon_nummer: o.telefoon_nummer,
          type: String(meta.type ?? ""),
          betaald: (meta.betaald as boolean | null) ?? null,
          mp_tags: String(meta.mp_tags ?? ""),
          datum: templatePlandatum,
          opmerkingen_klant: String(meta.opmerkingen_klant ?? ""),
          bezorgtijd_voorkeur: String(meta.bezorgtijd_voorkeur ?? ""),
          in_planning_en_ritjes_vandaag: inPlanningEnRitjesVandaag,
          ...(o.section === "nieuwe_order"
            ? {
                leveringLabelOverride: (nieuweOrderIsMorgen ? "morgen" : "vandaag") as
                  | "vandaag"
                  | "morgen",
              }
            : {}),
        },
        { ownerEmail }
      );

      if (sendRes.ok) {
        sentCount += 1;
        details.push(`Order ${o.order_nummer}: verzonden`);
      } else {
        failCount += 1;
        details.push(`Order ${o.order_nummer}: ${sendRes.error ?? "mislukt"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `${sentCount} verzonden, ${failCount} mislukt.`,
      details,
      orderUpdates,
    });
  } catch (e) {
    console.error("[api/stuur-appjes]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
