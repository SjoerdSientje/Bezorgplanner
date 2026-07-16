import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail } from "@/lib/auth-shared";

/**
 * "MP-pauzeknop": geheime veiligheidsschakelaar die, zolang hij AAN staat, alle
 * niet-afgeronde Marktplaats-orders (source = 'mp', status != 'mp_orders') overal
 * in de Bezorgplanner laat verdwijnen alsof ze niet bestaan (ritjes, planning,
 * route genereren, planning goedkeuren, appjes), én de "MP orders" (afgeronde
 * MP-orders) pagina verbergt. Niets wordt verwijderd — alleen gefilterd bij het
 * lezen. Nogmaals de geheime pagina + wachtwoord gebruiken zet het weer aan/uit.
 */
export const MP_PAUSE_OWNER_EMAIL = "info@koopjefatbike.nl";
const MP_PAUSE_SETTINGS_KEY = "mp_orders_paused";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export function mpPauseAppliesToOwner(ownerEmail: string | null | undefined): boolean {
  return normalizeEmail(ownerEmail ?? "") === normalizeEmail(MP_PAUSE_OWNER_EMAIL);
}

/** Huidige status van de MP-pauzeknop voor dit account (altijd `false` voor andere accounts). */
export async function isMpPausedForOwner(
  supabase: AnySupabase,
  ownerEmail: string | null | undefined
): Promise<boolean> {
  if (!mpPauseAppliesToOwner(ownerEmail)) return false;
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", MP_PAUSE_SETTINGS_KEY)
    .maybeSingle();
  return data?.value === "true";
}

/** Zet de MP-pauzeknop aan/uit. Werkt alleen voor {@link MP_PAUSE_OWNER_EMAIL}. */
export async function setMpPaused(supabase: AnySupabase, paused: boolean): Promise<void> {
  await supabase
    .from("settings")
    .upsert({ key: MP_PAUSE_SETTINGS_KEY, value: paused ? "true" : "false" });
}

/**
 * Zelfde "is dit een MP-order?"-definitie als elders in de app (afronden-route,
 * ritjes-mapping.ts): source = 'mp', OF mp_tags bevat "mp" als los woord, OF
 * order_nummer begint met "#MP" (Shopify-orders die via Marktplaats binnenkomen
 * hebben `source = 'shopify'` maar wél een mp_tags/order_nummer-signaal).
 */
function isMpTagged(mpTags: unknown): boolean {
  return /\bmp\b/.test(String(mpTags ?? "").trim().toLowerCase());
}

function isMpOrderNummer(orderNummer: unknown): boolean {
  return /^#mp/i.test(String(orderNummer ?? "").trim());
}

export function isMpOrder(order: {
  source?: unknown;
  mp_tags?: unknown;
  order_nummer?: unknown;
}): boolean {
  return order?.source === "mp" || isMpTagged(order?.mp_tags) || isMpOrderNummer(order?.order_nummer);
}

/** Een MP-order die nog niet is afgerond (dus onderdeel van de actieve/operationele flow). */
export function isIncompleteMpOrder(order: {
  source?: unknown;
  status?: unknown;
  mp_tags?: unknown;
  order_nummer?: unknown;
}): boolean {
  return isMpOrder(order) && order?.status !== "mp_orders";
}

/**
 * Filtert (indien `paused`) alle nog-niet-afgeronde MP-orders uit een lijst orders.
 * Vereist dat `source`, `status`, `mp_tags` en `order_nummer` in de select staan
 * (bv. via `select("*")`) — velden die ontbreken tellen simpelweg niet mee als signaal.
 */
export function filterOutPausedMpOrders<
  T extends { source?: unknown; status?: unknown; mp_tags?: unknown; order_nummer?: unknown }
>(orders: T[], paused: boolean): T[] {
  if (!paused) return orders;
  return orders.filter((o) => !isIncompleteMpOrder(o));
}

/** Aantal nog-niet-afgeronde MP-orders — gebruikt als preview op de veiligheidspagina. */
export async function countIncompleteMpOrders(
  supabase: AnySupabase,
  ownerEmail: string
): Promise<number> {
  const { data } = await supabase
    .from("orders")
    .select("id, source, status, mp_tags, order_nummer")
    .eq("owner_email", ownerEmail)
    .neq("status", "mp_orders");
  return ((data ?? []) as Array<Record<string, unknown>>).filter((o) => isIncompleteMpOrder(o)).length;
}

/**
 * Gegeven een lijst order-ids (bv. uit `planning_slots`, die zelf geen `source`/`status`
 * hebben), geeft de subset terug die (als de pauzeknop aan staat) een nog-niet-afgeronde
 * MP-order is en dus overal genegeerd moet worden.
 */
export async function findPausedMpOrderIds(
  supabase: AnySupabase,
  ownerEmail: string,
  orderIds: string[]
): Promise<Set<string>> {
  const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Set();
  const paused = await isMpPausedForOwner(supabase, ownerEmail);
  if (!paused) return new Set();

  const { data } = await supabase
    .from("orders")
    .select("id, source, status, mp_tags, order_nummer")
    .eq("owner_email", ownerEmail)
    .in("id", uniqueIds);

  const result = new Set<string>();
  for (const o of (data ?? []) as Array<Record<string, unknown>>) {
    if (isIncompleteMpOrder(o)) result.add(String(o.id));
  }
  return result;
}
