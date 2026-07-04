import type { ShopifyAdminProduct } from "@/lib/shopify-admin";

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
];

export function isExcludedFromInventory(product: ShopifyAdminProduct): boolean {
  const title = product.title.trim();
  const lower = title.toLowerCase();

  if (lower.includes("onderhoudspakket")) return true;
  if (/^volledig rijklaar$/i.test(title)) return true;

  for (const rule of INVENTORY_BUNDLE_RULES) {
    if (rule.lineItemMatch.test(title)) return true;
  }

  return false;
}

/** Family-Deal fietsen: extra kinderzitjes/windscherm automatisch van voorraad. */
const FAMILY_DEAL_SET_A = [
  "Kinderzitje achter Qibbel 6+ met voetsteunen, gordel en beschermplaat",
  "Kinderzitje voor Qibbel Air",
] as const;

const FAMILY_DEAL_SET_B = [
  "Kinderzitje achter Qibbel 6+ met voetsteunen, gordel en beschermplaat",
  "Kinderzitje voor Qibbel Air",
  "Windscherm Qibbel",
] as const;

const FAMILY_DEAL_SET_C = [
  "Kinderzitje achter Qibbel Air met dragerbevestiging",
  "Kinderzitje voor Qibbel Air",
  "Windscherm Qibbel",
] as const;

/** Bepaalt extra voorraaditems bij Family-Deal fietsen (lege lijst = geen family deal). */
export function getFamilyDealInventoryItems(bikeName: string): string[] {
  const name = String(bikeName ?? "").trim();
  if (!/family/i.test(name)) return [];

  if (
    /OUXI\s+V8\s+6\.0\s*\(?C80\)?.*Junior\s*6\+/i.test(name) ||
    /ENGWE\s+E26.*Junior\s*6\+\s*&\s*Peuter/i.test(name)
  ) {
    return [...FAMILY_DEAL_SET_C];
  }

  if (
    /OUXI\s+V8\s+6\.0\s*\(?C80\)?/i.test(name) ||
    (/ENGWE\s+E26/i.test(name) && /Peuter/i.test(name))
  ) {
    return [...FAMILY_DEAL_SET_B];
  }

  if (/V20\s*PRO\s+Fatbike/i.test(name) || /ENGWE\s+L20\s+Boost/i.test(name)) {
    return [...FAMILY_DEAL_SET_A];
  }

  return [];
}

/** Geen fysiek product — overslaan bij voorraadaftrek. */
export function shouldSkipInventoryDeductionLineItem(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (n === "volledig rijklaar" || n === "rijklaar" || n === "in doos") return true;
  if (n.includes("onderhoudspakket")) return true;
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
