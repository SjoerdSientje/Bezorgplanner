/**
 * Eenmalige opschoning: oude MP-orders zetten fietsregels op prijs 999 als dummy
 * om "fiets" te detecteren. Dat vervangen we door 0 zodat het echte ordertotaal
 * (bestelling_totaal_prijs) niet meer met 999 wordt verward.
 */

export type LineItemJsonRow = {
  name?: string;
  price?: number;
  isFiets?: boolean;
  properties?: { name?: string; value?: string }[];
  defaultItems?: string[];
};

export function hasLeveringProperty(
  properties: { name?: string | null; value?: string | null }[] | null | undefined
): boolean {
  return (properties ?? []).some(
    (p) =>
      String(p.name ?? "").trim().toLowerCase() === "levering" &&
      String(p.value ?? "").trim() !== ""
  );
}

/**
 * Vervangt MP-dummy 999 (fietsregels met Levering) door 0.
 * Alleen voor brondata die we als MP-dummy herkennen; geen Shopify €999-fietsen.
 */
export function stripMpDummyPricesFromLineItemsJsonString(
  lineItemsJson: string | null | undefined
): { json: string | null; changed: boolean } {
  if (!lineItemsJson?.trim()) return { json: lineItemsJson ?? null, changed: false };
  try {
    const arr = JSON.parse(lineItemsJson) as LineItemJsonRow[];
    if (!Array.isArray(arr)) return { json: lineItemsJson, changed: false };
    let changed = false;
    for (const item of arr) {
      const p = item.price;
      if (p !== 999) continue;
      if (item.isFiets || hasLeveringProperty(item.properties)) {
        item.price = 0;
        changed = true;
      }
    }
    if (!changed) return { json: lineItemsJson, changed: false };
    return { json: JSON.stringify(arr), changed: true };
  } catch {
    return { json: lineItemsJson, changed: false };
  }
}
