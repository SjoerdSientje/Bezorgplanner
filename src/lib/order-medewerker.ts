/** Medewerkers die een MP- of reparatie-order mogen aanmaken. */

export const ORDER_MEDEWERKERS = [
  "Sientje",
  "Merlin",
  "Zafar",
  "Kippetje",
  "Lieuwe",
  "Held",
] as const;

export type OrderMedewerker = (typeof ORDER_MEDEWERKERS)[number];

export function isOrderMedewerker(value: unknown): value is OrderMedewerker {
  return ORDER_MEDEWERKERS.includes(String(value ?? "").trim() as OrderMedewerker);
}

export function parseOrderMedewerker(value: unknown): OrderMedewerker | null {
  const raw = String(value ?? "").trim();
  return isOrderMedewerker(raw) ? raw : null;
}

/** Extra info onder bestaand achtergrondverhaal plakken. */
export function appendAchtergrondverhaal(
  existing: string | null | undefined,
  addition: string | null | undefined
): string | null {
  const base = String(existing ?? "").trim();
  const add = String(addition ?? "").trim();
  if (!add) return base || null;
  if (!base) return add;
  return `${base}\n\n${add}`;
}
