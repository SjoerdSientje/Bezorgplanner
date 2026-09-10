import type { ShopifyAdminProduct } from "@/lib/shopify-admin";
import { isPartsNonStockShopifyTitle } from "@/lib/inventory-parts-rules";

export type InventoryBundleRule = {
  /** Herken line-item naam (orderregel). */
  lineItemMatch: RegExp;
  /** Zoekterm voor doelproduct in voorraad (ilike op title). */
  targetTitleContains: string;
  /** Hoeveel stuks van doelproduct per bestelde bundelregel. */
  unitsPerLineItem: number;
};

export const INVENTORY_BUNDLE_RULES: InventoryBundleRule[] = [
  {
    lineItemMatch: /2x\s*anti[- ]?lekbanden.*montage/i,
    targetTitleContains: "Anti-lek Band 20x4",
    unitsPerLineItem: 2,
  },
  {
    lineItemMatch: /handvaten geschikt voor v8/i,
    targetTitleContains: "Handvat 1x geschikt voor V8 - H9 - V20",
    unitsPerLineItem: 2,
  },
];

export function isExcludedFromInventory(product: ShopifyAdminProduct): boolean {
  const title = product.title.trim();

  // Sets / unit-maps / expliciete excludes krijgen geen eigen voorraadrij.
  if (isPartsNonStockShopifyTitle(title)) return true;

  for (const rule of INVENTORY_BUNDLE_RULES) {
    if (rule.lineItemMatch.test(title)) return true;
  }

  return false;
}

/** Geen fysiek product — overslaan bij voorraadaftrek. */
export function shouldSkipInventoryDeductionLineItem(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (n === "volledig rijklaar" || n === "rijklaar" || n === "in doos") return true;
  if (n.includes("onderhoudspakket")) return true;
  if (n.includes("graag verzekeren")) return true;
  if (n.includes("opladerdoosje") || n.includes("opladerdoos")) return true;
  if (n === "fietspompje") return true;
  if (n.includes("achterzitje ouxi v8")) return true;
  if (n.includes("voorrekje voor fatbikes")) return true;
  if (n.includes("range rover velar")) return true;
  return false;
}

export function resolveBundleDeduction(item: {
  name?: string | null;
  quantity?: number | null;
}): { targetTitleContains: string; quantity: number } | null {
  const name = String(item.name ?? "").trim();
  if (!name) return null;

  const lineQty = Math.max(1, Math.floor(Number(item.quantity ?? 1)));

  for (const rule of INVENTORY_BUNDLE_RULES) {
    if (!rule.lineItemMatch.test(name)) continue;
    return {
      targetTitleContains: rule.targetTitleContains,
      quantity: rule.unitsPerLineItem * lineQty,
    };
  }

  return null;
}
