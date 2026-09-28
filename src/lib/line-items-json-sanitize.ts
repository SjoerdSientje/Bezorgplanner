/**
 * Historisch: oude MP-testorders zetten fietsregels op prijs 999 als dummy.
 * Dat strippen we niet meer — echte Shopify-fietsen kosten ook vaak €999, en
 * er zijn geen (niet-malyar) testorders meer die deze dummy nodig hebben.
 * Functie blijft bestaan zodat oude imports niet breken; resultaat = ongewijzigd.
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

/** No-op: toon opgeslagen prijzen 1:1 (geen 999→0). */
export function stripMpDummyPricesFromLineItemsJsonString(
  lineItemsJson: string | null | undefined,
  _orderTotal?: number | null
): { json: string | null; changed: boolean } {
  return { json: lineItemsJson ?? null, changed: false };
}
