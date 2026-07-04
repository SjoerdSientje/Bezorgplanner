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
  const n = v.trim().replace(/:$/, "").trim().toLowerCase();
  // "rijklaar" zonder "in doos" → volledig rijklaar
  if (n === "rijklaar") return "volledig rijklaar";
  return n;
}

function matchesModels(model: string, targets: string[]): boolean {
  const ml = model.toLowerCase().trim();
  return targets.some((t) => ml.includes(t.toLowerCase().trim()));
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
  let levering = normaliseerLevering(leveringRaw);

  // Fallback: als er geen Levering property is, lees het uit de productnaam.
  // Manual orders hebben "rijklaar" in de titel; Shopify Combi-Deal heeft geen aparte property.
  if (!levering) {
    if (
      naamLower.includes("rijklaar") ||
      naamLower.includes("combi-deal") ||
      naamLower.includes("combi deal")
    ) {
      levering = "volledig rijklaar";
    } else if (naamLower.includes("in doos")) {
      levering = "in doos";
    }
  }

  // Combineer modelExtras van de meegegeven rules (eventueel DB) én altijd de hardcoded
  // defaults, zodat nieuwe modellen in defaults automatisch voor alle gebruikers werken —
  // ook als zij eerder een versie zonder die modellen in de DB hebben opgeslagen.
  function mergedExtras(
    custom: ProductDefaultItemsRulesV1["volledigRijklaar"]["modelExtras"]
  ): ProductDefaultItemsRulesV1["volledigRijklaar"]["modelExtras"] {
    const base = DEFAULT_PRODUCT_RULES_V1.volledigRijklaar.modelExtras;
    if (custom === base) return base;
    const combined = [...base];
    for (const cg of custom) {
      const key = cleanLines(cg.items).sort().join("|");
      const existingIdx = combined.findIndex(
        (d) => cleanLines(d.items).sort().join("|") === key
      );
      if (existingIdx >= 0) {
        const existingModels = new Set(combined[existingIdx].models.map((m) => m.toLowerCase()));
        const newModels = cg.models.filter((m) => !existingModels.has(m.toLowerCase()));
        if (newModels.length) {
          combined[existingIdx] = { ...combined[existingIdx], models: [...combined[existingIdx].models, ...newModels] };
        }
      } else {
        combined.push(cg);
      }
    }
    return combined;
  }

  if (levering === "volledig rijklaar") {
    if (!excluded) {
      items.push(...vrStandardItems);
    }
    for (const g of mergedExtras(rules.volledigRijklaar.modelExtras)) {
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

/** Family-Deal fietsen: extra kinderzitjes/windscherm standaard inbegrepen. */
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

export function getFamilyDealDefaultItems(bikeName: string): string[] {
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

/** Standaard inbegrepen + family-deal items (voor UI, line_items_json en voorraad). */
export function getDefaultItemsForFiets(
  naam: string,
  rawProperties: ProductRuleLineProperty[],
  rules: ProductDefaultItemsRulesV1
): string[] {
  const base = applyProductDefaultItemsRules(naam, rawProperties, rules);
  const family = getFamilyDealDefaultItems(naam);
  if (family.length === 0) return base;

  const seen = new Set(base.map((s) => s.toLowerCase()));
  const merged = [...base];
  for (const item of family) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
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
