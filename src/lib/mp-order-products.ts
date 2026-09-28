/**
 * Marktplaats producten-lijst ↔ line_items_json helpers.
 */

import {
  buildLineItemsJson,
  extractModelnaamVanProduct,
  type ShopifyLineItem,
} from "@/lib/shopify-order";
import type { ProductDefaultItemsRulesV2 } from "@/lib/product-default-items-rules";

export type MpProductType = "fiets" | "extra";
export type MpLevering = "Volledig rijklaar" | "In doos";
export type MpJaNee = "ja" | "nee" | null;

export type MpProductRegel = {
  type: MpProductType;
  naam: string;
  prijs?: string | number | null;
  levering: MpLevering;
  montageOpmerking: string;
  achterzitje?: MpJaNee;
  achterzitjeGemonteerd?: MpJaNee;
  voorrekje?: MpJaNee;
  voorrekjeGemonteerd?: MpJaNee;
  shopify_product_id?: number | null;
  shopify_variant_id?: number | null;
};

export function parsePrijs(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function buildMpFietsNaamMetMontage(p: MpProductRegel): string {
  const suffix: string[] = [];
  if (p.achterzitje === "ja" && p.achterzitjeGemonteerd === "ja") {
    suffix.push("achterzitje gemonteerd");
  }
  if (p.voorrekje === "ja" && p.voorrekjeGemonteerd === "ja") {
    suffix.push("voorrekje gemonteerd");
  }
  const base = String(p.naam ?? "").trim();
  if (!base) return base;
  return suffix.length > 0 ? `${base} + ${suffix.join(" + ")}` : base;
}

export function buildMpShopifyLineItems(
  productenLijst: MpProductRegel[]
): ShopifyLineItem[] {
  if (!productenLijst?.length) return [];
  const lineItems: ShopifyLineItem[] = [];

  for (const p of productenLijst) {
    const productPrijs = parsePrijs(p.prijs);

    if (p.type === "fiets") {
      const montageProps: { name: string; value: string }[] = [];

      if (p.achterzitje === "ja") {
        if (p.achterzitjeGemonteerd === "ja") {
          montageProps.push({ name: "Montage", value: "achterzitje gemonteerd" });
        } else if (p.achterzitjeGemonteerd === "nee") {
          montageProps.push({ name: "Achterzitje", value: "Apart in doos" });
        }
      }

      if (p.voorrekje === "ja") {
        if (p.voorrekjeGemonteerd === "ja") {
          montageProps.push({ name: "Montage", value: "voorrekje gemonteerd" });
        } else if (p.voorrekjeGemonteerd === "nee") {
          montageProps.push({ name: "Voorrekje", value: "Apart in doos" });
        }
      }

      const props = [
        { name: "Levering", value: p.levering },
        ...montageProps,
        ...(p.montageOpmerking?.trim()
          ? [{ name: "Montage opmerking", value: p.montageOpmerking.trim() }]
          : []),
      ];

      lineItems.push({
        name: buildMpFietsNaamMetMontage(p),
        price: productPrijs,
        properties: props,
        product_id: p.shopify_product_id ?? undefined,
        variant_id: p.shopify_variant_id ?? undefined,
      });
    } else {
      lineItems.push({
        name: p.naam,
        price: productPrijs,
        properties: [],
        product_id: p.shopify_product_id ?? undefined,
        variant_id: p.shopify_variant_id ?? undefined,
      });
    }
  }

  return lineItems;
}

export function buildMpLineItemsJson(
  productenLijst: MpProductRegel[],
  rules: ProductDefaultItemsRulesV2
): string | null {
  const lineItems = buildMpShopifyLineItems(productenLijst);
  if (!lineItems.length) return null;
  return buildLineItemsJson({ line_items: lineItems }, rules);
}

export function collectMpUnmountedAccessoryDeductions(
  productenLijst: MpProductRegel[]
): Array<{ name: string; quantity: number }> {
  const out: Array<{ name: string; quantity: number }> = [];
  for (const p of productenLijst) {
    if (p.type !== "fiets") continue;
    if (p.achterzitje === "ja" && p.achterzitjeGemonteerd === "nee") {
      out.push({ name: "achterzitje", quantity: 1 });
    }
    if (p.voorrekje === "ja" && p.voorrekjeGemonteerd === "nee") {
      out.push({ name: "voorrekje", quantity: 1 });
    }
  }
  return out;
}

export function productenTekstFromMpLijst(
  productenLijst: MpProductRegel[]
): string | null {
  if (!productenLijst.length) return null;
  return productenLijst
    .flatMap((p) => {
      if (p.type !== "fiets") return [String(p.naam ?? "").trim()];
      const lines = [buildMpFietsNaamMetMontage(p)];
      if (p.achterzitje === "ja" && p.achterzitjeGemonteerd === "nee") {
        lines.push("Achterzitje: Apart in doos");
      }
      if (p.voorrekje === "ja" && p.voorrekjeGemonteerd === "nee") {
        lines.push("Voorrekje: Apart in doos");
      }
      return lines;
    })
    .filter(Boolean)
    .join("\n");
}

export function modelFromMpLijst(productenLijst: MpProductRegel[]): string | null {
  const eersteFiets = productenLijst.find((p) => p.type === "fiets");
  if (!eersteFiets) return null;
  return extractModelnaamVanProduct(eersteFiets.naam);
}

type StoredLineItem = {
  name?: string;
  price?: number | string;
  isFiets?: boolean;
  properties?: { name: string; value: string }[];
  product_id?: number | string | null;
  variant_id?: number | string | null;
};

function propValue(
  props: { name: string; value: string }[] | undefined,
  name: string
): string {
  const hit = (props ?? []).find(
    (p) => String(p.name ?? "").toLowerCase() === name.toLowerCase()
  );
  return String(hit?.value ?? "").trim();
}

function stripGemonteerdSuffix(naam: string): string {
  return String(naam ?? "")
    .replace(/\s*\+\s*achterzitje gemonteerd/gi, "")
    .replace(/\s*\+\s*voorrekje gemonteerd/gi, "")
    .replace(/\s*\+\s*/g, " + ")
    .trim();
}

/** Reconstructeer bewerkbare productregels vanuit opgeslagen line_items_json. */
export function parseMpProductenFromLineItemsJson(
  lineItemsJson: string | null | undefined | unknown
): MpProductRegel[] {
  if (lineItemsJson == null || lineItemsJson === "") return [];
  let items: StoredLineItem[] = [];
  try {
    const parsed =
      typeof lineItemsJson === "string"
        ? (JSON.parse(lineItemsJson) as unknown)
        : lineItemsJson;
    if (!Array.isArray(parsed)) return [];
    items = parsed as StoredLineItem[];
  } catch {
    return [];
  }

  const out: MpProductRegel[] = [];
  for (const item of items) {
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    // Skip "Apart in doos" regels die als aparte tekstregel in producten staan
    // maar soms niet in JSON zitten; skip defaultItems-only ghosts.
    const levering = propValue(item.properties, "Levering");
    const isFiets =
      Boolean(item.isFiets) ||
      levering === "Volledig rijklaar" ||
      levering === "In doos";

    const prijs =
      item.price != null && item.price !== ""
        ? String(item.price)
        : "";

    if (isFiets) {
      const montages = (item.properties ?? [])
        .filter((p) => String(p.name ?? "").toLowerCase() === "montage")
        .map((p) => String(p.value ?? "").toLowerCase());
      const achterzitjeApart =
        propValue(item.properties, "Achterzitje").toLowerCase() === "apart in doos";
      const voorrekjeApart =
        propValue(item.properties, "Voorrekje").toLowerCase() === "apart in doos";
      const achterGemonteerd = montages.some((v) => v.includes("achterzitje"));
      const voorGemonteerd = montages.some((v) => v.includes("voorrekje"));

      out.push({
        type: "fiets",
        naam: stripGemonteerdSuffix(name),
        prijs,
        levering:
          levering === "In doos" ? "In doos" : "Volledig rijklaar",
        montageOpmerking: propValue(item.properties, "Montage opmerking"),
        achterzitje: achterGemonteerd || achterzitjeApart ? "ja" : null,
        achterzitjeGemonteerd: achterGemonteerd
          ? "ja"
          : achterzitjeApart
            ? "nee"
            : null,
        voorrekje: voorGemonteerd || voorrekjeApart ? "ja" : null,
        voorrekjeGemonteerd: voorGemonteerd
          ? "ja"
          : voorrekjeApart
            ? "nee"
            : null,
        shopify_product_id:
          item.product_id != null ? Number(item.product_id) || null : null,
        shopify_variant_id:
          item.variant_id != null ? Number(item.variant_id) || null : null,
      });
    } else {
      out.push({
        type: "extra",
        naam: name,
        prijs,
        levering: "Volledig rijklaar",
        montageOpmerking: "",
        achterzitje: null,
        achterzitjeGemonteerd: null,
        voorrekje: null,
        voorrekjeGemonteerd: null,
        shopify_product_id:
          item.product_id != null ? Number(item.product_id) || null : null,
        shopify_variant_id:
          item.variant_id != null ? Number(item.variant_id) || null : null,
      });
    }
  }
  return out;
}
