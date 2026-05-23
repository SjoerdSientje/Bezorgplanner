import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanningDateForGoedkeuren } from "@/lib/planning-date";

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
  // Alleen lopende slots van VANDAAG tellen mee als "bezorgronde bezig".
  // Stale slots van gisteren of eerder mogen de doeldatum niet naar morgen schuiven.
  const todayAmsterdam = getTodayAmsterdam();
  const { count } = await supabase
    .from("planning_slots")
    .select("id", { count: "exact", head: true })
    .eq("owner_email", ownerEmail)
    .eq("datum", todayAmsterdam)
    .neq("status", "afgerond");

  if ((count ?? 0) > 0) {
    return { date: getTomorrowAmsterdam(), isRitjesVoorMorgen: true };
  }
  const { date } = getPlanningDateForGoedkeuren();
  return { date, isRitjesVoorMorgen: false };
}

/**
 * Gebruikt door "Stuur appjes → Nieuwe order":
 * Voeg toe aan de VROEGSTE (huidige/actieve) bestaande planning-batch.
 * Zo gaat een nieuw order bij een lopende planning voor vandaag mee in die planning,
 * ook als morgen al is goedgekeurd.
 * Als er geen actieve slots zijn → planningDate (zelfde 18:00-rollover als route/ritjes).
 */
export async function getLatestOrNewPlanningDate(
  ownerEmail: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
): Promise<string> {
  const { data: earliestSlot } = await supabase
    .from("planning_slots")
    .select("datum")
    .eq("owner_email", ownerEmail)
    .neq("status", "afgerond")
    .order("datum", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (earliestSlot?.datum) {
    return String(earliestSlot.datum);
  }
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

  const { count } = await supabase
    .from("planning_slots")
    .select("id", { count: "exact", head: true })
    .eq("owner_email", ownerEmail)
    .eq("datum", todayISO)
    .neq("status", "afgerond");

  if ((count ?? 1) > 0) return;

  const { data: futureSlots } = await supabase
    .from("planning_slots")
    .select("id, datum")
    .eq("owner_email", ownerEmail)
    .gt("datum", todayISO)
    .neq("status", "afgerond")
    .order("datum", { ascending: true });

  if (!futureSlots?.length) return;

  // Promote only the earliest future date
  const nextDate = (futureSlots[0] as { datum: string }).datum;
  const idsToPromote = (futureSlots as { id: string; datum: string }[])
    .filter((s) => s.datum === nextDate)
    .map((s) => s.id);

  if (!idsToPromote.length) return;

  await supabase
    .from("planning_slots")
    .update({ datum: todayISO })
    .eq("owner_email", ownerEmail)
    .in("id", idsToPromote);
}
