/**
 * Bepalen van de planningdatum: voor cutoff = vandaag, vanaf cutoff = morgen.
 * Tijdzone: Europe/Amsterdam.
 * @param cutoffHour Uur (0-23) waarop overgegaan wordt naar morgen; standaard 18.
 */
export function getPlanningDate(cutoffHour: number = 18): { date: string; isTomorrow: boolean } {
  const now = new Date();
  const amsterdam = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const hour = amsterdam.getHours();
  const minute = amsterdam.getMinutes();
  const totalMinutes = hour * 60 + minute;
  const cutoff = cutoffHour * 60;

  if (totalMinutes >= cutoff) {
    amsterdam.setDate(amsterdam.getDate() + 1);
  }
  const y = amsterdam.getFullYear();
  const m = String(amsterdam.getMonth() + 1).padStart(2, "0");
  const d = String(amsterdam.getDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    isTomorrow: totalMinutes >= cutoff,
  };
}

/** Planningdatum voor 'Planning goedkeuren': vanaf 17:00 = morgen. */
export function getPlanningDateForGoedkeuren() {
  return getPlanningDate(17);
}
