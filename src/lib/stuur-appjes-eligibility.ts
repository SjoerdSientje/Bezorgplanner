/** Geldig klanttijdslot: HH:MM - HH:MM */
const AANKOMSTTIJD_SLOT_RE = /^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*$/;

export function hasValidAankomsttijdSlot(slot: unknown): boolean {
  const s = String(slot ?? "").trim();
  return s !== "" && AANKOMSTTIJD_SLOT_RE.test(s);
}

/** Zelfde criteria als planning goedkeuren / Lijst Sjoerd voor appjes. */
export function isStuurAppjesEligibleOrder(o: {
  meenemen_in_planning?: boolean | null;
  aankomsttijd_slot?: string | null;
}): boolean {
  if (o.meenemen_in_planning !== true) return false;
  return hasValidAankomsttijdSlot(o.aankomsttijd_slot);
}
