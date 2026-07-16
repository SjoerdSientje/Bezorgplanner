import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanningDateForGoedkeuren, comparePlanningDatumKeys } from "@/lib/planning-date";
import { findPausedMpOrderIds } from "@/lib/mp-pause";

function getTodayAmsterdam(): string {
  const now = new Date();
  const amsterdam = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const y = amsterdam.getFullYear();
  const m = String(amsterdam.getMonth() + 1).padStart(2, "0");
  const d = String(amsterdam.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTomorrowAmsterdam(): string {
  const now = new Date();
  const amsterdam = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  amsterdam.setDate(amsterdam.getDate() + 1);
  const y = amsterdam.getFullYear();
  const m = String(amsterdam.getMonth() + 1).padStart(2, "0");
  const d = String(amsterdam.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Gebruikt door "Planning goedkeuren":
 * - Als er actieve planning-slots zijn → morgen (nieuwe batch als "ritjes voor morgen")
 * - Als planning leeg is → planningDate (vóór 18:00 Amsterdam = vandaag, daarna = morgen)
 */
export async function getTargetPlanningDate(
  ownerEmail: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
): Promise<{ date: string; isRitjesVoorMorgen: boolean }> {
  const tomorrowAmsterdam = getTomorrowAmsterdam();
  const todayAmsterdam = getTodayAmsterdam();

  const { data: activeSlots } = await supabase
    .from("planning_slots")
    .select("id, order_id")
    .eq("owner_email", ownerEmail)
    .gte("datum", todayAmsterdam)
    .neq("status", "afgerond");

  const slotRows = (activeSlots ?? []) as Array<{ id: string; order_id: string }>;
  const pausedMpOrderIds = await findPausedMpOrderIds(
    supabase,
    ownerEmail,
    slotRows.map((s) => s.order_id)
  );
  const relevantSlots = slotRows.filter((s) => !pausedMpOrderIds.has(String(s.order_id)));

  const hasActivePlanning = relevantSlots.length > 0;
  if (hasActivePlanning) {
    return { date: tomorrowAmsterdam, isRitjesVoorMorgen: true };
  }

  const { date } = getPlanningDateForGoedkeuren();
  return { date, isRitjesVoorMorgen: false };
}

/**
 * Gebruikt door "Stuur appjes → Nieuwe order":
 * - Lopende planning vandaag + al een batch morgen → nieuwe order naar morgen.
 * - Alleen lopende planning (geen morgen-batch) → naar die actieve planning.
 * - Geen actieve slots → planningDate (18:00-rollover).
 */
export async function getLatestOrNewPlanningDate(
  ownerEmail: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
): Promise<string> {
  const today = getTodayAmsterdam();
  const tomorrow = getTomorrowAmsterdam();

  const { data: slots } = await supabase
    .from("planning_slots")
    .select("datum, order_id")
    .eq("owner_email", ownerEmail)
    .neq("status", "afgerond");

  const slotRows = (slots ?? []) as Array<{ datum: string; order_id: string }>;
  const pausedMpOrderIds = await findPausedMpOrderIds(
    supabase,
    ownerEmail,
    slotRows.map((s) => s.order_id)
  );

  const dates = new Set(
    slotRows
      .filter((s) => !pausedMpOrderIds.has(String(s.order_id)))
      .map((s) => String(s.datum ?? "").trim())
      .filter(Boolean)
  );

  const hasToday = dates.has(today);
  const hasTomorrow = dates.has(tomorrow);

  if (hasToday && hasTomorrow) return tomorrow;
  if (hasToday) return today;
  if (hasTomorrow) return tomorrow;

  const sorted = Array.from(dates).sort(comparePlanningDatumKeys);
  const futureOrToday = sorted.filter((d) => d >= today);
  if (futureOrToday.length > 0) return futureOrToday[0];

  const { date } = getPlanningDateForGoedkeuren();
  return date;
}

/**
 * Als er geen actieve planning-slots zijn voor vandaag, promoot de eerste
 * toekomstige batch planning-slots (morgen of later) naar vandaag.
 * Wordt aangeroepen na het verwijderen of afronden van een slot.
 */
export async function promoteRitjesVoorMorgen(
  ownerEmail: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
): Promise<void> {
  const todayISO = getTodayAmsterdam();

  const { data: todaySlots } = await supabase
    .from("planning_slots")
    .select("id, order_id")
    .eq("owner_email", ownerEmail)
    .eq("datum", todayISO)
    .neq("status", "afgerond");

  const todaySlotRows = (todaySlots ?? []) as Array<{ id: string; order_id: string }>;
  const pausedTodayIds = await findPausedMpOrderIds(
    supabase,
    ownerEmail,
    todaySlotRows.map((s) => s.order_id)
  );
  const relevantTodaySlots = todaySlotRows.filter((s) => !pausedTodayIds.has(String(s.order_id)));
  if (relevantTodaySlots.length > 0) return;

  const { data: futureSlots } = await supabase
    .from("planning_slots")
    .select("id, datum, order_id")
    .eq("owner_email", ownerEmail)
    .gt("datum", todayISO)
    .neq("status", "afgerond")
    .order("datum", { ascending: true });

  const futureSlotRows = (futureSlots ?? []) as Array<{ id: string; datum: string; order_id: string }>;
  const pausedFutureIds = await findPausedMpOrderIds(
    supabase,
    ownerEmail,
    futureSlotRows.map((s) => s.order_id)
  );
  const relevantFutureSlots = futureSlotRows.filter((s) => !pausedFutureIds.has(String(s.order_id)));

  if (!relevantFutureSlots.length) return;

  // Promote only the earliest future date
  const nextDate = relevantFutureSlots[0]!.datum;
  const idsToPromote = relevantFutureSlots.filter((s) => s.datum === nextDate).map((s) => s.id);

  if (!idsToPromote.length) return;

  await supabase
    .from("planning_slots")
    .update({ datum: todayISO })
    .eq("owner_email", ownerEmail)
    .in("id", idsToPromote);
}
