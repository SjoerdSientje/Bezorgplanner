import type { SupabaseClient } from "@supabase/supabase-js";

export const COMPLETED_ORDER_STATUSES = ["bezorgd", "mp_orders"] as const;

export type CompletedOrderStatus = (typeof COMPLETED_ORDER_STATUSES)[number];

export function inferCompletedStatus(row: {
  mp_tags?: string | null;
  order_nummer?: string | null;
}): CompletedOrderStatus {
  const tags = String(row.mp_tags ?? "").toLowerCase();
  if (/\bmp\b/.test(tags)) return "mp_orders";
  if (/^#mp/i.test(String(row.order_nummer ?? "").trim())) return "mp_orders";
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

/**
 * Herstel orders waar afronden is gelukt maar een Shopify-webhook status terugzette naar ritjes_vandaag.
 */
export async function repairCompletedOrdersWithWrongStatus(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<number> {
  const { data: broken, error } = await supabase
    .from("orders")
    .select("id, mp_tags, order_nummer")
    .eq("owner_email", ownerEmail)
    .eq("status", "ritjes_vandaag")
    .not("afgerond_at", "is", null);

  if (error) {
    console.error("[order-completion] repair query", error);
    return 0;
  }

  let repaired = 0;
  for (const row of broken ?? []) {
    const { error: updErr } = await supabase
      .from("orders")
      .update({ status: inferCompletedStatus(row) })
      .eq("id", row.id);
    if (!updErr) repaired += 1;
    else console.error("[order-completion] repair update", updErr);
  }
  return repaired;
}
