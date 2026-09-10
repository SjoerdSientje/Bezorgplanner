/**
 * Vaste regels voor Shopify-collecties "onderdelen" + "accessoires" → voorraad.
 * Bron van waarheid voor exclude / samenstellingen / multiplicators / duplicates.
 */

export type PartsCompositionComponent = {
  /** Exacte (of unieke) Shopify-producttitel van het component. */
  componentTitle: string;
  quantity: number;
};

export type PartsUnitMap = {
  /** Shopify-producttitel (bundle/paar). */
  sourceTitle: string;
  /** Voorraadrij / componenttitel waar vanaf afgeschreven wordt. */
  targetTitle: string;
  quantity: number;
};

/** Geen voorraadregel; orders schrijven niets af. */
export const PARTS_EXCLUDE_TITLES: string[] = [
  "Fietspompje",
  "Achterzitje Ouxi V8",
  "Voorrekje voor Fatbikes",
  "Kinderauto Range Rover Velar 12V met Afstandsbediening - Grijs, 1-persoons",
  "Kinderauto Range Rover Velar 12V met Afstandsbediening - Zwart, 1-persoons",
  "Volledig rijklaar",
  "Onderhoudspakket Bronze 🥉",
  "Onderhoudspakket Goud 🥇",
  "Onderhoudspakket Zilver 🥈",
  "E-bike/Fatbike graag verzekeren.",
];

/** Titel bevat dit (case-insensitive) → geen voorraad. */
export const PARTS_EXCLUDE_TITLE_INCLUDES: string[] = [
  "onderhoudspakket",
  "graag verzekeren",
];

/**
 * Sets: Shopify-product zelf geen voorraadrij; aftrek = componenten.
 */
export const PARTS_COMPOSITIONS: { setTitle: string; components: PartsCompositionComponent[] }[] =
  [
    {
      setTitle:
        "Hydraulische remset voorrem + achterrem Logan geschikt voor V20 & meer (inclusief remblokjes)",
      components: [
        {
          componentTitle:
            "Hydraulische achterrem Logan geschikt voor V20 & meer (inclusief remblokjes)",
          quantity: 1,
        },
        {
          componentTitle:
            "Hydraulische voorrem Logan geschikt voor V20 & meer (inclusief remblokjes)",
          quantity: 1,
        },
      ],
    },
    {
      setTitle: "Hydraulische Remset - Inclusief Remblokken",
      components: [
        {
          componentTitle: "Hydraulische achterrem - inclusief remblokken Zoom",
          quantity: 1,
        },
        {
          componentTitle: "Hydraulische voorrem - inclusief remblokken",
          quantity: 1,
        },
      ],
    },
    {
      setTitle:
        "Mechanische remset voor+achter | remhendel + remklauw + remkabel | geschikt voor onder andere V20 (incusief remblokken) (kopie)",
      components: [
        {
          componentTitle:
            "Mechanische achterrem | remhendel + remklauw + remkabel | geschikt voor onder andere V20 (incusief remblokken)",
          quantity: 1,
        },
        {
          componentTitle:
            "Mechanische voorrem | remhendel + remklauw + remkabel | geschikt voor onder andere V20 (incusief remblokken)",
          quantity: 1,
        },
      ],
    },
    {
      setTitle: "GT2000 remset",
      components: [
        { componentTitle: "GT2000-achterrem-rechts", quantity: 1 },
        { componentTitle: "GT2000-voorrem-links", quantity: 1 },
      ],
    },
    {
      setTitle: "Trapsensor + Cranktrekker Set voor OUXI Modellen",
      components: [
        {
          componentTitle:
            "Cranktrekker geschikt voor alle fatbikes (zelf trapsensor vervangen)",
          quantity: 1,
        },
        { componentTitle: "Ouxi - Trapsensor Geschikt voor OUXI", quantity: 1 },
      ],
    },
    {
      setTitle: "Ouxi - Koplamp met knipperlicht + kabelboom",
      components: [
        { componentTitle: "Ouxi - Koplamp met knipperlicht", quantity: 1 },
        {
          componentTitle:
            "Ouxi - Hoofdkabels / hoofdbekabeling met knipperlicht functie",
          quantity: 1,
        },
      ],
    },
  ];

/**
 * Paar/bundel → N stuks van een andere (unit) voorraadrij. Geen eigen voorraadrij.
 */
export const PARTS_UNIT_MAPS: PartsUnitMap[] = [
  {
    sourceTitle: "Handvaten geschikt voor V8 - H9 - V20",
    targetTitle: "Handvat 1x geschikt voor V8 - H9 - V20 Links / rechts",
    quantity: 2,
  },
  {
    sourceTitle: "2x Anti-lekbanden + montage",
    targetTitle: "Anti-lek Band 20x4 – Stevige kwaliteit met anti-leklaag",
    quantity: 2,
  },
];

/** Meerdere Shopify-producten → één gedeelde voorraadrij (canonical = eerste titel). */
export const PARTS_DUPLICATE_GROUPS: string[][] = [
  ["Koplamp V20", "Koplamp V20"],
];

export function normalizePartsTitle(title: string): string {
  return String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPartsExcludedTitle(title: string): boolean {
  const n = normalizePartsTitle(title);
  if (!n) return true;
  for (const exact of PARTS_EXCLUDE_TITLES) {
    if (normalizePartsTitle(exact) === n) return true;
  }
  for (const frag of PARTS_EXCLUDE_TITLE_INCLUDES) {
    if (n.includes(normalizePartsTitle(frag))) return true;
  }
  return false;
}

export function findPartsComposition(title: string) {
  const n = normalizePartsTitle(title);
  return PARTS_COMPOSITIONS.find((c) => normalizePartsTitle(c.setTitle) === n) ?? null;
}

export function findPartsUnitMap(title: string) {
  const n = normalizePartsTitle(title);
  return PARTS_UNIT_MAPS.find((u) => normalizePartsTitle(u.sourceTitle) === n) ?? null;
}

/** Titels die zelf geen voorraadrij krijgen (exclude / set / unit-map source). */
export function isPartsNonStockShopifyTitle(title: string): boolean {
  if (isPartsExcludedTitle(title)) return true;
  if (findPartsComposition(title)) return true;
  if (findPartsUnitMap(title)) return true;
  return false;
}

export function partsDuplicateCanonicalTitle(title: string): string | null {
  const n = normalizePartsTitle(title);
  // Beide Koplamp V20 producten delen één rij.
  if (n === normalizePartsTitle("Koplamp V20")) return "Koplamp V20";
  return null;
}
