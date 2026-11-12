import type { SupabaseClient } from "@supabase/supabase-js";

export const COMPLETED_ORDER_STATUSES = ["bezorgd", "mp_orders"] as const;

export type CompletedOrderStatus = (typeof COMPLETED_ORDER_STATUSES)[number];

export type CompletedStatusInput = {
  source?: string | null;
  type?: string | null;
  reparatie_betaalwijze?: string | null;
  moneybird_invoice_id?: string | null;
  mp_tags?: string | null;
  order_nummer?: string | null;
};

function isMpTagged(mpTags: unknown): boolean {
  return /\bmp\b/.test(String(mpTags ?? "").toLowerCase());
}

function isMpOrderNummer(orderNummer: unknown): boolean {
  return /^#mp/i.test(String(orderNummer ?? "").trim());
}

/**
 * Bestemming na afronden:
 * - Reparatie ophalen → altijd bezorgd (afgeronde/bezorgde orders)
 * - Reparatie deur/terugbrengen + factuur → bezorgd
 * - Reparatie deur/terugbrengen + contant → mp_orders
 * - Overige: MP-tag/nummer → mp_orders, anders bezorgd
 */
export function inferCompletedStatus(row: CompletedStatusInput): CompletedOrderStatus {
  const source = String(row.source ?? "").trim().toLowerCase();
  const type = String(row.type ?? "").trim().toLowerCase();

  if (source === "reparatie") {
    if (type === "reparatie_ophalen") return "bezorgd";
    if (type === "reparatie_deur" || type === "reparatie_terugbrengen") {
      const betaal = String(row.reparatie_betaalwijze ?? "").trim().toLowerCase();
      if (betaal === "contant") return "mp_orders";
      if (betaal === "factuur") return "bezorgd";
      // Fallback: factuur als er al een Moneybird-factuur hangt.
      if (String(row.moneybird_invoice_id ?? "").trim()) return "bezorgd";
      return "mp_orders";
    }
    return "bezorgd";
  }

  if (isMpTagged(row.mp_tags) || source === "mp" || isMpOrderNummer(row.order_nummer)) {
    return "mp_orders";
  }
  return "bezorgd";
}

/** Order is afgerond (status of afgerond_at). */
export function isOrderMarkedCompleted(row: {
  status?: string | null;
  afgerond_at?: string | null;
}): boolean {
  const status = String(row.status ?? "").trim();
  if (COMPLETED_ORDER_STATUSES.includes(status as CompletedOrderStatus)) return true;
  return Boolean(row.afgerond_at);
}

async function batchRepairStatus(
  supabase: SupabaseClient,
  ownerEmail: string,
  rows: Array<{
    id: string;
    source?: string | null;
    type?: string | null;
    reparatie_betaalwijze?: string | null;
    moneybird_invoice_id?: string | null;
    mp_tags?: string | null;
    order_nummer?: string | null;
    status?: string | null;
  }>
): Promise<number> {
  const byStatus = new Map<CompletedOrderStatus, string[]>();
  for (const row of rows) {
    const next = inferCompletedStatus(row);
    const current = String(row.status ?? "").trim();
    if (current === next) continue;
    const list = byStatus.get(next) ?? [];
    list.push(String(row.id));
    byStatus.set(next, list);
  }

  let repaired = 0;
  for (const [status, ids] of Array.from(byStatus.entries())) {
    if (ids.length === 0) continue;
    const { error: updErr } = await supabase
      .from("orders")
      .update({ status })
      .eq("owner_email", ownerEmail)
      .in("id", ids);
    if (!updErr) repaired += ids.length;
    else console.error("[order-completion] repair batch update", updErr);
  }
  return repaired;
}

/**
 * Herstel:
 * 1) open lijsten + afgerond_at (Shopify-webhook die status terugzette)
 * 2) afgeronde reparaties die nog in ritjes/gepland staan
 * Geen volledige historische scan van alle afgeronde reparaties op elke page-load.
 */
export async function repairCompletedOrdersWithWrongStatus(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<number> {
  const { data: brokenOpen, error: brokenErr } = await supabase
    .from("orders")
    .select(
      "id, source, type, reparatie_betaalwijze, moneybird_invoice_id, mp_tags, order_nummer, status"
    )
    .eq("owner_email", ownerEmail)
    .in("status", ["ritjes_vandaag", "gepland"])
    .not("afgerond_at", "is", null);

  if (brokenErr) {
    console.error("[order-completion] repair query (open+afgerond)", brokenErr);
    return 0;
  }

  type RepairRow = {
    id: string;
    source?: string | null;
    type?: string | null;
    reparatie_betaalwijze?: string | null;
    moneybird_invoice_id?: string | null;
    mp_tags?: string | null;
    order_nummer?: string | null;
    status?: string | null;
  };

  return batchRepairStatus(supabase, ownerEmail, (brokenOpen ?? []) as RepairRow[]);
}
