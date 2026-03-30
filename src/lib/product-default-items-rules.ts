import { extractModelnaamVanProduct } from "@/lib/bike-model-name";

/** Zelfde vorm als Shopify line item properties (los van shopify-order om cycles te vermijden). */
export type ProductRuleLineProperty = { name?: string | null; value?: string | null };

export type ProductDefaultItemsRulesV1 = {
  version: 1;
  /** Altijd toegevoegd; `{model}` wordt vervangen door het geëxtraheerde model. */
  always: string[];
  /**
   * Als de productnaam (lowercase) een van deze substrings bevat,
   * worden de standaard levering-items (ketting slot / tas bij VR, slot bij ID) overgeslagen.
   */
  excludedBrandKeywords: string[];
  volledigRijklaar: {
    /** Toegevoegd voor alle fietsen behalve excluded brands */
    standardItems: string[];
    /** Extra items als het model exact matcht (case-insensitive op modelstring) */
    modelExtras: { models: string[]; items: string[] }[];
  };
  inDoos: {
    standardItems: string[];
    modelExtras: { models: string[]; items: string[] }[];
  };
};

function normaliseerLevering(v: string): string {
  return v.trim().replace(/:$/, "").trim().toLowerCase();
}

function matchesModels(model: string, targets: string[]): boolean {
  const ml = model.toLowerCase().trim();
  return targets.some((t) => t.toLowerCase().trim() === ml);
}

function expandItemTemplates(items: string[], model: string): string[] {
  return items.map((t) => t.replace(/\{model\}/g, model));
}

function cleanLines(items: string[]): string[] {
  return items.map((s) => String(s ?? "").trim()).filter(Boolean);
}

/**
 * Standaard regels (gelijk aan de vroegere hardcoded logica in shopify-order).
 */
export const DEFAULT_PRODUCT_RULES_V1: ProductDefaultItemsRulesV1 = {
  version: 1,
  always: ["Fietspompje", "Opladerdoosje {model}"],
  excludedBrandKeywords: ["engwe", "ado"],
  volledigRijklaar: {
    standardItems: ["ART-2 kettingslot", "telefoontasje"],
    modelExtras: [
      {
        models: ["V8 MAX ultra", "V8 ultra"],
        items: ["goedkope spiegel links"],
      },
      {
        models: [
          "V20 Limited",
          "GT20",
          "V8 ultra mini",
          "V8 MAX ultra",
          "V8 ultra",
          "V8 PRO",
          "V8 PRO MAX",
          "Q8",
          "S20 PRO",
          "H9",
          "V20 PRO comfort",
        ],
        items: ["voorrekje"],
      },
    ],
  },
  inDoos: {
    standardItems: ["ART-2 kettingslot"],
    modelExtras: [
      {
        models: ["V20 Pro", "V20 Limited", "S20 Pro", "V20 mini", "V20 Pro Comfort"],
        items: ["Accu {model}"],
      },
      {
        models: ["V20 Pro", "V20 Pro comfort", "V20 Limited", "S20 Pro"],
        items: ["Display {model}", "Losse oplader {model}"],
      },
    ],
  },
};

export function applyProductDefaultItemsRules(
  naam: string,
  rawProperties: ProductRuleLineProperty[],
  rules: ProductDefaultItemsRulesV1
): string[] {
  const model = extractModelnaamVanProduct(naam);
  const naamLower = naam.toLowerCase();
  const excludedKeywords = cleanLines(rules.excludedBrandKeywords);
  const excluded = excludedKeywords.some((k) =>
    naamLower.includes(k.toLowerCase().trim())
  );

  const alwaysItems = cleanLines(rules.always);
  const vrStandardItems = cleanLines(rules.volledigRijklaar.standardItems);
  const idStandardItems = cleanLines(rules.inDoos.standardItems);
  const items: string[] = expandItemTemplates(alwaysItems, model);

  const leveringRaw =
    rawProperties.find((p) => p.name?.toLowerCase().trim() === "levering")?.value ?? "";
  const levering = normaliseerLevering(leveringRaw);

  if (levering === "volledig rijklaar") {
    if (!excluded) {
      items.push(...vrStandardItems);
    }
    for (const g of rules.volledigRijklaar.modelExtras) {
      const models = cleanLines(g.models);
      const groupItems = cleanLines(g.items);
      if (matchesModels(model, models)) {
        items.push(...expandItemTemplates(groupItems, model));
      }
    }
  } else if (levering === "in doos") {
    if (!excluded) {
      items.push(...idStandardItems);
    }
    for (const g of rules.inDoos.modelExtras) {
      const models = cleanLines(g.models);
      const groupItems = cleanLines(g.items);
      if (matchesModels(model, models)) {
        items.push(...expandItemTemplates(groupItems, model));
      }
    }
  }

  return items;
}

function isModelExtrasList(x: unknown): boolean {
  if (!Array.isArray(x)) return false;
  for (const g of x) {
    if (!g || typeof g !== "object") return false;
    const row = g as Record<string, unknown>;
    if (!Array.isArray(row.models) || !Array.isArray(row.items)) return false;
  }
  return true;
}

export function isProductDefaultItemsRulesV1(x: unknown): x is ProductDefaultItemsRulesV1 {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (!Array.isArray(o.always)) return false;
  if (!Array.isArray(o.excludedBrandKeywords)) return false;
  if (!o.volledigRijklaar || typeof o.volledigRijklaar !== "object") return false;
  if (!o.inDoos || typeof o.inDoos !== "object") return false;
  const vr = o.volledigRijklaar as Record<string, unknown>;
  const id = o.inDoos as Record<string, unknown>;
  if (!Array.isArray(vr.standardItems) || !isModelExtrasList(vr.modelExtras)) return false;
  if (!Array.isArray(id.standardItems) || !isModelExtrasList(id.modelExtras)) return false;
  return true;
}
