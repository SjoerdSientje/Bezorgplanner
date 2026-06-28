import type {
  ShopifyAdminProduct,
  ShopifyAdminProductOption,
  ShopifyAdminProductVariant,
} from "@/lib/shopify-admin";

/** Opties die fysieke voorraad onderscheiden. */
const STOCK_OPTION_NAMES = new Set(["Kleur", "BAFANG AutoShift motor", "Motorkabel"]);

type ColorPattern = { pattern: RegExp; label: string };

const COLOR_PATTERNS: ColorPattern[] = [
  { pattern: /\bwijn[- ]?rood\b/i, label: "Rood" },
  { pattern: /\bmat[- ]?zwart\b/i, label: "Zwart" },
  { pattern: /\bmorning dew\b/i, label: "Morning Dew" },
  { pattern: /\bspace grey\b/i, label: "Space Grey" },
  { pattern: /\bdonkergrijs\b/i, label: "Donkergrijs" },
  { pattern: /\bnavy blauw\b/i, label: "Navy Blauw" },
  { pattern: /\bolive groen\b/i, label: "Olive Groen" },
  { pattern: /\bsky blauw\b/i, label: "Sky Blauw" },
  { pattern: /\bnardo grey\b/i, label: "Nardo Grey" },
  { pattern: /\barmy green\b/i, label: "Army Green" },
  { pattern: /\blichtblauw\b/i, label: "Lichtblauw" },
  { pattern: /\bdonkerblauw\b/i, label: "Donkerblauw" },
  { pattern: /\bblauw\b/i, label: "Blauw" },
  { pattern: /\bzwart\b/i, label: "Zwart" },
  { pattern: /\bgrijs\b/i, label: "Grijs" },
  { pattern: /\bgroen\b/i, label: "Groen" },
  { pattern: /\brood\b/i, label: "Rood" },
  { pattern: /\boranje\b/i, label: "Oranje" },
  { pattern: /\bwit\b/i, label: "Wit" },
  { pattern: /\bruin\b/i, label: "Bruin" },
  { pattern: /\btaupe\b/i, label: "Taupe" },
  { pattern: /\bgeel\b/i, label: "Geel" },
  { pattern: /\broze\b/i, label: "Roze" },
  { pattern: /\bpaars\b/i, label: "Paars" },
  { pattern: /\bgrey\b/i, label: "Grijs" },
  { pattern: /\bblack\b/i, label: "Zwart" },
  { pattern: /\bwhite\b/i, label: "Wit" },
  { pattern: /\bred\b/i, label: "Rood" },
  { pattern: /\bgreen\b/i, label: "Groen" },
  { pattern: /\bblue\b/i, label: "Blauw" },
];

export type InventoryStockKeyInfo = {
  groupKey: string;
  modelName: string;
  colorName: string | null;
  trimLabel: string | null;
  displayTitle: string;
};

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function colorKey(color: string): string {
  return color.trim().toLowerCase();
}

function getOptionValue(
  variant: ShopifyAdminProductVariant,
  options: ShopifyAdminProductOption[],
  optionName: string
): string | null {
  const idx = options.findIndex((o) => o.name === optionName);
  if (idx < 0) return null;
  const value = idx === 0 ? variant.option1 : idx === 1 ? variant.option2 : variant.option3;
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

/** Verwijder marketing/accessoire-tekst die geen aparte fiets is. */
export function cleanTitleForGrouping(title: string): string {
  return title
    .replace(/[\u2600-\u27BF]/g, "")
    .replace(/🔥|🥉|🥇|🥈|🎁/g, "")
    .replace(/\s*\|\s*family[- ]?deal[^|]*/gi, "")
    .replace(/\s*\|\s*combi[- ]?deal[^|]*/gi, "")
    .replace(/family[- ]?deal\s*\+\s*combi[- ]?deal/gi, "")
    .replace(/family[- ]?deal/gi, "")
    .replace(/combi[- ]?deal/gi, "")
    .replace(/\bjunior\s*6\+?\s*(&\s*peuter)?/gi, "")
    .replace(/\bpeuter\b/gi, "")
    .replace(/\s*\+\s*ringslot/gi, "")
    .replace(/\s*\+\s*achterzitje/gi, "")
    .replace(/\bbasic\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractColorFromTitle(title: string): string | null {
  for (const { pattern, label } of COLOR_PATTERNS) {
    if (pattern.test(title)) return label;
  }
  return null;
}

function stripTrailingColorSuffix(title: string): string {
  const patterns = [
    /\s*[-–|]\s*(morning dew|space grey|donkergrijs|navy blauw|olive groen|sky blauw|lichtblauw|donkerblauw|army green|nardo grey|mat[- ]?zwart|wijn[- ]?rood|blauw|zwart|grijs|groen|rood|oranje|wit|bruin|taupe|geel|roze|paars|grey|black|white|red|green|blue)\s*$/i,
    /\s*\((grijs|navy blauw|olive green|oranje|sky blauw|taupe)\)\s*$/i,
  ];
  let result = title.trim();
  for (const pattern of patterns) {
    result = result.replace(pattern, "").trim();
  }
  return result;
}

type ModelColor = { modelName: string; colorName: string | null };

function normalizeEngweL20Boost(title: string): ModelColor | null {
  if (!/ENGWE L20 Boost/i.test(title)) return null;
  const cleaned = cleanTitleForGrouping(title);
  const color = extractColorFromTitle(cleaned);
  return { modelName: "ENGWE L20 Boost - Fatbike", colorName: color };
}

function normalizeEngweE26(title: string): ModelColor | null {
  if (!/ENGWE E26/i.test(title)) return null;
  const cleaned = cleanTitleForGrouping(title);
  const instap = /hoge instap/i.test(cleaned) ? "Hoge instap" : "Lage instap";
  const color = extractColorFromTitle(cleaned);
  return { modelName: `ENGWE E26 - ${instap} - Fatbike`, colorName: color };
}

function normalizeOuxiV8C80(title: string): ModelColor | null {
  if (!/(OUXI\s+V8|C80)/i.test(title)) return null;

  const cleaned = cleanTitleForGrouping(title);

  if (/Ultra\s+Mini/i.test(cleaned)) return null;
  if (/Ultra\s+Fatbike/i.test(cleaned) && !/6\.0|C80/i.test(cleaned)) return null;
  if (/MAX/i.test(cleaned) && /Dubbele/i.test(cleaned)) return null;

  if (/24\s*inch/i.test(cleaned)) {
    const color = extractColorFromTitle(cleaned);
    if (/PRO\s*MAX/i.test(cleaned)) {
      return { modelName: "OUXI V8 / C80 PRO MAX Fatbike 24 inch", colorName: color };
    }
    if (/PRO/i.test(cleaned)) {
      return { modelName: "OUXI V8 / C80 PRO Fatbike 24 inch", colorName: color };
    }
    return { modelName: "OUXI V8 / C80 Fatbike 24 inch", colorName: color };
  }

  if (/6\.0\s+Fatbike/i.test(cleaned) && /mat[- ]?zwart/i.test(cleaned)) {
    return { modelName: "OUXI V8 / C80 6.0 Fatbike", colorName: "Zwart" };
  }

  if (
    (/V8\s*\/\s*C80\s*PRO\s+Fatbike/i.test(cleaned) && !/MAX/i.test(cleaned)) ||
    /6\.0\s*\(C80\)\s+Fatbike/i.test(cleaned)
  ) {
    return { modelName: "OUXI V8 / C80 Fatbike", colorName: extractColorFromTitle(cleaned) };
  }

  return null;
}

function normalizeV20ProFatbike(title: string): ModelColor | null {
  const cleaned = cleanTitleForGrouping(title);
  if (/Comfort|C28/i.test(cleaned)) return null;
  if (/V20\s*PRO\s+Fatbike/i.test(cleaned) || /V20Pro\s+Fatbike/i.test(cleaned)) {
    return {
      modelName: "V20 PRO Fatbike",
      colorName: extractColorFromTitle(cleaned),
    };
  }
  return null;
}

function resolveModelAndColor(productTitle: string): ModelColor {
  const title = productTitle.trim();

  const special =
    normalizeEngweL20Boost(title) ??
    normalizeEngweE26(title) ??
    normalizeOuxiV8C80(title) ??
    normalizeV20ProFatbike(title);

  if (special) return special;

  if (/STOER UrbanX/i.test(title)) {
    return { modelName: "STOER UrbanX", colorName: extractColorFromTitle(title) };
  }

  if (/ENGWE Engine Pro 2\.0/i.test(title)) {
    return {
      modelName: "ENGWE Engine Pro 2.0 - Elektrische vouwfiets",
      colorName: extractColorFromTitle(title),
    };
  }

  const cleaned = cleanTitleForGrouping(title);
  return {
    modelName: stripTrailingColorSuffix(cleaned),
    colorName: extractColorFromTitle(title),
  };
}

export function normalizeInventoryModelName(productTitle: string): string {
  return resolveModelAndColor(productTitle).modelName;
}

function shortTrimLabel(optionName: string, value: string): string {
  if (optionName === "BAFANG AutoShift motor") {
    if (/3-speed/i.test(value)) return "3-speed Ultra";
    if (/2-speed/i.test(value)) return "2-speed Pro";
    return value.trim();
  }
  if (optionName === "Motorkabel") {
    if (/rood/i.test(value)) return "Rode kabel";
    if (/zwart/i.test(value)) return "Zwarte kabel";
    return value.trim();
  }
  return value.trim();
}

function normalizeColorLabel(color: string): string {
  return extractColorFromTitle(color) ?? color.trim();
}

export function buildInventoryStockKeyInfo(
  product: ShopifyAdminProduct,
  variant: ShopifyAdminProductVariant
): InventoryStockKeyInfo {
  const options = product.options ?? [];
  const resolved = resolveModelAndColor(product.title);
  const dimensions: string[] = [];
  let colorName = resolved.colorName;
  let trimLabel: string | null = null;

  for (const optionName of Array.from(STOCK_OPTION_NAMES)) {
    const value = getOptionValue(variant, options, optionName);
    if (!value) continue;
    if (optionName === "Kleur") {
      colorName = normalizeColorLabel(value);
      dimensions.push(`kleur:${colorKey(colorName)}`);
    } else {
      trimLabel = shortTrimLabel(optionName, value);
      dimensions.push(`${slugPart(optionName)}:${slugPart(value)}`);
    }
  }

  if (colorName && !dimensions.some((d) => d.startsWith("kleur:"))) {
    dimensions.unshift(`kleur:${colorKey(colorName)}`);
  }

  const modelName = resolved.modelName;
  const groupKey =
    dimensions.length > 0
      ? `${slugPart(modelName)}|${dimensions.join("|")}`
      : `product:${slugPart(modelName)}`;

  const displayParts = [modelName];
  if (colorName) displayParts.push(colorName);
  if (trimLabel) displayParts.push(trimLabel);

  return {
    groupKey,
    modelName,
    colorName,
    trimLabel,
    displayTitle: displayParts.join(" — "),
  };
}
