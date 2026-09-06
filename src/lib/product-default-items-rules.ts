import { extractModelnaamVanProduct } from "@/lib/bike-model-name";

/** Zelfde vorm als Shopify line item properties (los van shopify-order om cycles te vermijden). */
export type ProductRuleLineProperty = { name?: string | null; value?: string | null };

/** @deprecated Alleen voor migratie vanaf opgeslagen v1-regels. */
export type ProductDefaultItemsRulesV1 = {
  version: 1;
  always: string[];
  excludedBrandKeywords: string[];
  volledigRijklaar: {
    standardItems: string[];
    modelExtras: { models: string[]; items: string[] }[];
  };
  inDoos: {
    standardItems: string[];
    modelExtras: { models: string[]; items: string[] }[];
  };
};

export type ProductRuleItemKind = "inventory" | "text";

/** Eén standaard-productregel: gekoppeld aan voorraad of alleen tekst (geen aftrek). */
export type ProductRuleItem = {
  id: string;
  kind: ProductRuleItemKind;
  /** Paklijst/UI-label; `{model}` mag bij tekstregels. */
  label: string;
  inventoryProductId?: string | null;
  /** Cache voor weergave in de editor. */
  inventoryProductTitle?: string | null;
};

export type ProductRuleMatchMode = "contains" | "exact";

export type ProductRuleMatch = {
  id: string;
  mode: ProductRuleMatchMode;
  value: string;
};

export type ProductRuleExceptionGroup = {
  id: string;
  name: string;
  matches: ProductRuleMatch[];
  /** Ids van standaard-items in hetzelfde leveringsblok die níet meekomen. */
  excludeItemIds: string[];
};

export type ProductRuleModelExtraGroup = {
  id: string;
  name: string;
  matches: ProductRuleMatch[];
  items: ProductRuleItem[];
};

export type ProductRuleDeliveryBlock = {
  standardItems: ProductRuleItem[];
  exceptionGroups: ProductRuleExceptionGroup[];
  modelExtras: ProductRuleModelExtraGroup[];
};

export type ProductDefaultItemsRulesV2 = {
  version: 2;
  always: ProductRuleItem[];
  volledigRijklaar: ProductRuleDeliveryBlock;
  inDoos: ProductRuleDeliveryBlock;
};

export type ProductDefaultItemsRules = ProductDefaultItemsRulesV2;

export type ResolvedDefaultItem = {
  label: string;
  inventoryProductId: string | null;
};

function cleanLines(items: string[]): string[] {
  return items.map((s) => String(s ?? "").trim()).filter(Boolean);
}

function textItem(id: string, label: string): ProductRuleItem {
  return { id, kind: "text", label, inventoryProductId: null, inventoryProductTitle: null };
}

function emptyDelivery(): ProductRuleDeliveryBlock {
  return { standardItems: [], exceptionGroups: [], modelExtras: [] };
}

/** Standaard regels (v1-bron, gemigreerd naar v2). */
const DEFAULT_PRODUCT_RULES_V1_SOURCE: ProductDefaultItemsRulesV1 = {
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

function migrateDeliveryFromV1(
  block: ProductDefaultItemsRulesV1["volledigRijklaar"],
  prefix: string,
  excludedBrandKeywords: string[]
): ProductRuleDeliveryBlock {
  const standardItems = cleanLines(block.standardItems).map((label, i) =>
    textItem(`${prefix}-std-${i}`, label)
  );

  const keywords = cleanLines(excludedBrandKeywords);
  const exceptionGroups: ProductRuleExceptionGroup[] = [];
  if (keywords.length > 0 && standardItems.length > 0) {
    exceptionGroups.push({
      id: `${prefix}-excl-brands`,
      name: "Geen standaard slot / tas (merken)",
      matches: keywords.map((value, i) => ({
        id: `${prefix}-excl-m-${i}`,
        mode: "contains" as const,
        value,
      })),
      excludeItemIds: standardItems.map((s) => s.id),
    });
  }

  const modelExtras: ProductRuleModelExtraGroup[] = (block.modelExtras ?? []).map((g, gi) => ({
    id: `${prefix}-extra-${gi}`,
    name: `Extra groep ${gi + 1}`,
    matches: cleanLines(g.models).map((value, mi) => ({
      id: `${prefix}-extra-${gi}-m-${mi}`,
      mode: "contains" as const,
      value,
    })),
    items: cleanLines(g.items).map((label, ii) =>
      textItem(`${prefix}-extra-${gi}-i-${ii}`, label)
    ),
  }));

  return { standardItems, exceptionGroups, modelExtras };
}

export function migrateV1RulesToV2(v1: ProductDefaultItemsRulesV1): ProductDefaultItemsRulesV2 {
  return {
    version: 2,
    always: cleanLines(v1.always).map((label, i) => textItem(`always-${i}`, label)),
    volledigRijklaar: migrateDeliveryFromV1(
      v1.volledigRijklaar,
      "vr",
      v1.excludedBrandKeywords
    ),
    inDoos: migrateDeliveryFromV1(v1.inDoos, "id", v1.excludedBrandKeywords),
  };
}

export const DEFAULT_PRODUCT_RULES_V2: ProductDefaultItemsRulesV2 = migrateV1RulesToV2(
  DEFAULT_PRODUCT_RULES_V1_SOURCE
);

/** @deprecated Alleen migratiebron; runtime gebruikt v2. */
export const DEFAULT_PRODUCT_RULES_V1 = DEFAULT_PRODUCT_RULES_V1_SOURCE;

export const DEFAULT_PRODUCT_RULES = DEFAULT_PRODUCT_RULES_V2;

function normaliseerLevering(v: string): string {
  const n = v.trim().replace(/:$/, "").trim().toLowerCase();
  if (n === "rijklaar") return "volledig rijklaar";
  return n;
}

function expandLabel(label: string, model: string): string {
  return label.replace(/\{model\}/g, model);
}

function resolveItem(item: ProductRuleItem, model: string): ResolvedDefaultItem | null {
  const rawLabel =
    item.kind === "inventory"
      ? item.label.trim() || item.inventoryProductTitle?.trim() || ""
      : item.label.trim();
  if (!rawLabel && item.kind !== "inventory") return null;
  if (item.kind === "inventory" && !item.inventoryProductId && !rawLabel) return null;

  const label = expandLabel(
    rawLabel || item.inventoryProductTitle?.trim() || "Product",
    model
  );
  return {
    label,
    inventoryProductId:
      item.kind === "inventory" && item.inventoryProductId
        ? item.inventoryProductId
        : null,
  };
}

function resolveItems(items: ProductRuleItem[], model: string): ResolvedDefaultItem[] {
  const out: ResolvedDefaultItem[] = [];
  for (const item of items) {
    const resolved = resolveItem(item, model);
    if (resolved) out.push(resolved);
  }
  return out;
}

export function matchProductRule(
  match: ProductRuleMatch,
  productName: string,
  model: string
): boolean {
  const v = String(match.value ?? "").trim().toLowerCase();
  if (!v) return false;
  const modelL = model.toLowerCase().trim();
  const nameL = productName.toLowerCase();
  if (match.mode === "exact") {
    return modelL === v;
  }
  return nameL.includes(v) || modelL.includes(v);
}

function anyMatch(
  matches: ProductRuleMatch[],
  productName: string,
  model: string
): boolean {
  return matches.some((m) => matchProductRule(m, productName, model));
}

function detectLevering(
  naam: string,
  rawProperties: ProductRuleLineProperty[]
): "volledig rijklaar" | "in doos" | "" {
  const naamLower = naam.toLowerCase();
  const leveringRaw =
    rawProperties.find((p) => p.name?.toLowerCase().trim() === "levering")?.value ?? "";
  let levering = normaliseerLevering(leveringRaw);

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

  if (levering === "volledig rijklaar" || levering === "in doos") return levering;
  return "";
}

function applyDeliveryBlock(
  block: ProductRuleDeliveryBlock,
  productName: string,
  model: string
): ResolvedDefaultItem[] {
  const excludedIds = new Set<string>();
  for (const group of block.exceptionGroups ?? []) {
    if (anyMatch(group.matches ?? [], productName, model)) {
      for (const id of group.excludeItemIds ?? []) {
        if (id) excludedIds.add(id);
      }
    }
  }

  const standard = (block.standardItems ?? []).filter((item) => !excludedIds.has(item.id));
  const out = resolveItems(standard, model);

  for (const extra of block.modelExtras ?? []) {
    if (!anyMatch(extra.matches ?? [], productName, model)) continue;
    out.push(...resolveItems(extra.items ?? [], model));
  }

  return out;
}

export function applyProductDefaultItemsRulesResolved(
  naam: string,
  rawProperties: ProductRuleLineProperty[],
  rules: ProductDefaultItemsRulesV2
): ResolvedDefaultItem[] {
  const model = extractModelnaamVanProduct(naam);
  const items = resolveItems(rules.always ?? [], model);
  const levering = detectLevering(naam, rawProperties);

  if (levering === "volledig rijklaar") {
    items.push(...applyDeliveryBlock(rules.volledigRijklaar, naam, model));
  } else if (levering === "in doos") {
    items.push(...applyDeliveryBlock(rules.inDoos, naam, model));
  }

  return items;
}

export function applyProductDefaultItemsRules(
  naam: string,
  rawProperties: ProductRuleLineProperty[],
  rules: ProductDefaultItemsRulesV2
): string[] {
  return applyProductDefaultItemsRulesResolved(naam, rawProperties, rules).map((r) => r.label);
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

export function getResolvedDefaultItemsForFiets(
  naam: string,
  rawProperties: ProductRuleLineProperty[],
  rules: ProductDefaultItemsRulesV2
): ResolvedDefaultItem[] {
  const base = applyProductDefaultItemsRulesResolved(naam, rawProperties, rules);
  const family = getFamilyDealDefaultItems(naam);
  if (family.length === 0) return base;

  const seen = new Set(base.map((s) => s.label.toLowerCase()));
  const merged = [...base];
  for (const item of family) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ label: item, inventoryProductId: null });
  }
  return merged;
}

/** Standaard inbegrepen + family-deal items (labels voor UI / paklijst). */
export function getDefaultItemsForFiets(
  naam: string,
  rawProperties: ProductRuleLineProperty[],
  rules: ProductDefaultItemsRulesV2
): string[] {
  return getResolvedDefaultItemsForFiets(naam, rawProperties, rules).map((r) => r.label);
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

function isModelExtrasListV1(x: unknown): boolean {
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
  if (!isStringArray(o.always)) return false;
  if (!isStringArray(o.excludedBrandKeywords)) return false;
  if (!o.volledigRijklaar || typeof o.volledigRijklaar !== "object") return false;
  if (!o.inDoos || typeof o.inDoos !== "object") return false;
  const vr = o.volledigRijklaar as Record<string, unknown>;
  const id = o.inDoos as Record<string, unknown>;
  if (!isStringArray(vr.standardItems) || !isModelExtrasListV1(vr.modelExtras)) return false;
  if (!isStringArray(id.standardItems) || !isModelExtrasListV1(id.modelExtras)) return false;
  return true;
}

function isProductRuleItem(x: unknown): x is ProductRuleItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (o.kind !== "inventory" && o.kind !== "text") return false;
  if (typeof o.label !== "string") return false;
  return true;
}

function isProductRuleMatch(x: unknown): x is ProductRuleMatch {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (o.mode !== "contains" && o.mode !== "exact") return false;
  if (typeof o.value !== "string") return false;
  return true;
}

function isDeliveryBlock(x: unknown): x is ProductRuleDeliveryBlock {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.standardItems) || !o.standardItems.every(isProductRuleItem)) return false;
  if (!Array.isArray(o.exceptionGroups)) return false;
  for (const g of o.exceptionGroups) {
    if (!g || typeof g !== "object") return false;
    const row = g as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") return false;
    if (!Array.isArray(row.matches) || !row.matches.every(isProductRuleMatch)) return false;
    if (!Array.isArray(row.excludeItemIds) || !row.excludeItemIds.every((id) => typeof id === "string")) {
      return false;
    }
  }
  if (!Array.isArray(o.modelExtras)) return false;
  for (const g of o.modelExtras) {
    if (!g || typeof g !== "object") return false;
    const row = g as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") return false;
    if (!Array.isArray(row.matches) || !row.matches.every(isProductRuleMatch)) return false;
    if (!Array.isArray(row.items) || !row.items.every(isProductRuleItem)) return false;
  }
  return true;
}

export function isProductDefaultItemsRulesV2(x: unknown): x is ProductDefaultItemsRulesV2 {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 2) return false;
  if (!Array.isArray(o.always) || !o.always.every(isProductRuleItem)) return false;
  if (!isDeliveryBlock(o.volledigRijklaar)) return false;
  if (!isDeliveryBlock(o.inDoos)) return false;
  return true;
}

/** Accepteert v1 of v2; normaliseert altijd naar v2. */
export function normalizeProductDefaultItemsRules(x: unknown): ProductDefaultItemsRulesV2 {
  if (isProductDefaultItemsRulesV2(x)) return x;
  if (isProductDefaultItemsRulesV1(x)) return migrateV1RulesToV2(x);
  return DEFAULT_PRODUCT_RULES_V2;
}

export function isProductDefaultItemsRules(x: unknown): x is ProductDefaultItemsRulesV2 {
  return isProductDefaultItemsRulesV2(x) || isProductDefaultItemsRulesV1(x);
}

export function newProductRuleId(prefix = "r"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyRuleItem(kind: ProductRuleItemKind = "text"): ProductRuleItem {
  return {
    id: newProductRuleId("item"),
    kind,
    label: "",
    inventoryProductId: null,
    inventoryProductTitle: null,
  };
}

export function createEmptyMatch(mode: ProductRuleMatchMode = "contains"): ProductRuleMatch {
  return { id: newProductRuleId("match"), mode, value: "" };
}

export function createEmptyExceptionGroup(): ProductRuleExceptionGroup {
  return {
    id: newProductRuleId("excl"),
    name: "Nieuwe uitzonderingsgroep",
    matches: [createEmptyMatch("contains")],
    excludeItemIds: [],
  };
}

export function createEmptyModelExtraGroup(): ProductRuleModelExtraGroup {
  return {
    id: newProductRuleId("extra"),
    name: "Nieuwe modelgroep",
    matches: [createEmptyMatch("contains")],
    items: [createEmptyRuleItem("text")],
  };
}

export function createEmptyDeliveryBlock(): ProductRuleDeliveryBlock {
  return emptyDelivery();
}
