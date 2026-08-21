/**
 * Herorden orders op een route op tijdslot (vroeg → laat) en sync rit_nummer.
 * Optioneel ook planning_slots.volgorde per datum.
 */

import { supabaseMissingOrdersRouteNummerColumn } from "@/lib/orders-route-nummer-supabase";

/** Startminuten van "HH:MM - HH:MM"; nachtelijke wraps (0–5u) +24u. */
export function tijdslotStartMinutes(slot: string | null | undefined): number {
  const t = String(slot ?? "").split(" - ")[0]?.replace(".", ":").trim() ?? "";
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h)) return 9999;
  let mins = h * 60 + (Number.isFinite(m) ? m : 0);
  if (h >= 0 && h < 6) mins += 24 * 60;
  return mins;
}

export type ResequencedOrder = {
  id: string;
  route_nummer: number | null;
  rit_nummer: number;
  aankomsttijd_slot: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

async function patchOrderFields(
  supabase: AnySupabase,
  ownerEmail: string,
  orderId: string,
  payload: {
    route_nummer?: number | null;
    rit_nummer?: number | null;
    aankomsttijd_slot?: string | null;
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
 * Zet rit_nummer 1..n voor alle meegenomen ritjes-orders op deze route, gesorteerd op tijdslot.
 */
export async function resequenceRouteOrdersByTijdslot(
  supabase: AnySupabase,
  ownerEmail: string,
  routeNummer: number | null
): Promise<ResequencedOrder[]> {
  let q = supabase
    .from("orders")
    .select("id, aankomsttijd_slot, route_nummer, rit_nummer, meenemen_in_planning, status")
    .eq("owner_email", ownerEmail)
    .eq("meenemen_in_planning", true)
    .in("status", ["ritjes_vandaag", "gepland"]);

  if (routeNummer == null) {
    q = q.or("route_nummer.is.null,route_nummer.eq.0");
  } else {
    q = q.eq("route_nummer", routeNummer);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[route-resequence] orders:", error);
    return [];
  }

  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (o) => String(o.aankomsttijd_slot ?? "").trim() !== ""
  );

  rows.sort(
    (a, b) =>
      tijdslotStartMinutes(String(a.aankomsttijd_slot ?? "")) -
      tijdslotStartMinutes(String(b.aankomsttijd_slot ?? ""))
  );

  const out: ResequencedOrder[] = [];
  for (let i = 0; i < rows.length; i++) {
    const o = rows[i]!;
    const id = String(o.id);
    const rit = i + 1;
    const rn =
      routeNummer == null
        ? null
        : Number.isFinite(routeNummer) && routeNummer > 0
          ? routeNummer
          : null;
    await patchOrderFields(supabase, ownerEmail, id, {
      rit_nummer: rit,
      route_nummer: rn,
    });
    out.push({
      id,
      route_nummer: rn,
      rit_nummer: rit,
      aankomsttijd_slot: o.aankomsttijd_slot ? String(o.aankomsttijd_slot) : null,
    });
  }
  return out;
}

/**
 * Zet planning_slots.volgorde per route op een datum (vroeg→laat via order.tijdslot / rit_nummer).
 */
export async function resequencePlanningSlotsByTijdslot(
  supabase: AnySupabase,
  ownerEmail: string,
  datum: string
): Promise<void> {
  const { data: slots, error } = await supabase
    .from("planning_slots")
    .select("id, order_id, volgorde")
    .eq("owner_email", ownerEmail)
    .eq("datum", datum)
    .neq("status", "afgerond");
  if (error || !slots?.length) return;

  const orderIds = Array.from(
    new Set(slots.map((s: { order_id: string }) => String(s.order_id)))
  );
  const { data: orders } = await supabase
    .from("orders")
    .select("id, route_nummer, rit_nummer, aankomsttijd_slot")
    .eq("owner_email", ownerEmail)
    .in("id", orderIds);

  const orderById = new Map<string, Record<string, unknown>>(
    (orders ?? []).map((o: Record<string, unknown>) => [String(o.id), o])
  );

  type SlotRow = { id: string; order_id: string };
  const byRoute = new Map<string, SlotRow[]>();
  for (const s of slots as SlotRow[]) {
    const o = orderById.get(String(s.order_id));
    const rn = Number(o?.route_nummer ?? 0);
    const key = rn > 0 ? String(rn) : "overig";
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(s);
  }

  for (const group of Array.from(byRoute.values())) {
    group.sort((a: SlotRow, b: SlotRow) => {
      const oa = orderById.get(String(a.order_id));
      const ob = orderById.get(String(b.order_id));
      const ra = Number(oa?.rit_nummer ?? 0);
      const rb = Number(ob?.rit_nummer ?? 0);
      if (ra > 0 && rb > 0 && ra !== rb) return ra - rb;
      return (
        tijdslotStartMinutes(String(oa?.aankomsttijd_slot ?? "")) -
        tijdslotStartMinutes(String(ob?.aankomsttijd_slot ?? ""))
      );
    });
    for (let i = 0; i < group.length; i++) {
      await supabase
        .from("planning_slots")
        .update({ volgorde: i + 1 })
        .eq("owner_email", ownerEmail)
        .eq("id", group[i]!.id);
    }
  }
}
