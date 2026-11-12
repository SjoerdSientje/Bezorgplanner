/**
 * Gedeelde voorraad: de varianten blijven een eigen voorraadregel, en hangen
 * samen onder één totaal. Dat totaal is de som. Een bestelling of correctie
 * op één variant verlaagt dus ook het totaal; de andere variant blijft staan.
 *
 * Koppeling loopt via group_key, niet via de titel, zodat een hernoemde
 * onderliggende voorraad in dezelfde groep blijft.
 */

export type InventoryStockPoolDefinition = {
  id: string;
  title: string;
  groupKeys: readonly string[];
};

export const INVENTORY_STOCK_POOLS: readonly InventoryStockPoolDefinition[] = [
  {
    id: "opvoerset-ouxi",
    title:
      "Opvoerset voor OUXI - V8 - C80 - Q8 - PRO - Alle OUXI modellen Fatbike – Zonder Extra Display – Direct Leverbaar",
    groupKeys: [
      "opvoerset-voor-ouxi-v8-c80-q8-pro-alle-ouxi-modellen-fatbike-zonder-extra-display-direct-leverbaar|motorkabel:rode-motorkabel",
      "opvoerset-voor-ouxi-v8-c80-q8-pro-alle-ouxi-modellen-fatbike-zonder-extra-display-direct-leverbaar|motorkabel:zwarte-motorkabel",
    ],
  },
  {
    id: "opvoerset-v20",
    title:
      "Opvoerset voor V20 Pro, S20 & V30 Fatbike – Zonder Extra Display – Direct Leverbaar",
    groupKeys: [
      "opvoerset-voor-v20-pro-s20-v30-fatbike-zonder-extra-display-direct-leverbaar|motorkabel:rode-motorkabel",
      "opvoerset-voor-v20-pro-s20-v30-fatbike-zonder-extra-display-direct-leverbaar|motorkabel:zwarte-motorkabel",
    ],
  },
  {
    id: "v20-motor-klein",
    title: "V20 motor inclusief achterwiel - kleine motor",
    groupKeys: [
      "parts:v20-motor-inclusief-achterwiel-rode-kabel-kleine-motor",
      "parts:v20-motor-inclusief-achterwiel-zwarte-kabel-kleine-motor",
    ],
  },
  {
    id: "v20-motor-groot",
    title: "V20 motor inclusief achterwiel - grote motor",
    groupKeys: [
      "parts:v20-motor-inclusief-achterwiel-rode-kabel-grote-motor",
      "parts:v20-motor-inclusief-achterwiel-zwarte-kabel-grote-motor",
    ],
  },
  {
    id: "ouxi-motor-klein",
    title: "OUXI motor inclusief achterwiel - kleine motor",
    groupKeys: [
      "parts:ouxi-motor-inclusief-achterwiel-rode-kabel-kleine-motor",
      "parts:ouxi-motor-inclusief-achterwiel-zwarte-kabel-kleine-motor-kopie",
    ],
  },
  {
    id: "ouxi-motor-groot",
    title: "OUXI motor inclusief achterwiel - grote motor",
    groupKeys: [
      "parts:ouxi-motor-inclusief-achterwiel-rode-kabel-grote-motor",
      "parts:ouxi-motor-inclusief-achterwiel-zwarte-kabel-grote-motor",
    ],
  },
  {
    id: "motor-500w",
    title: "Motor 500W Fatbike - OUXI & V20",
    groupKeys: [
      "parts:losse-motor-500w-fatbike-rode-kabel-ouxi-v20",
      "parts:motor-500w-fatbike-zwarte-kabel-ouxi-v20-grote-motor",
    ],
  },
  {
    id: "motor-250w",
    title: "Losse Motor 250W Fatbike – OUXI & V20",
    groupKeys: [
      "parts:losse-motor-250w-fatbike-rode-kabel-ouxi-v20",
      "parts:losse-motor-250w-fatbike-zwarte-kabel-ouxi-v20",
    ],
  },
];

const poolByGroupKey = new Map<string, InventoryStockPoolDefinition>();
for (const pool of INVENTORY_STOCK_POOLS) {
  for (const groupKey of pool.groupKeys) poolByGroupKey.set(groupKey, pool);
}

export function findInventoryStockPool(
  groupKey: string | null | undefined
): InventoryStockPoolDefinition | null {
  if (!groupKey) return null;
  return poolByGroupKey.get(groupKey) ?? null;
}

export function attachInventoryStockPool<T extends { group_key?: string | null }>(
  product: T
): T & { stock_pool_id: string | null; stock_pool_title: string | null } {
  const pool = findInventoryStockPool(product.group_key);
  return {
    ...product,
    stock_pool_id: pool?.id ?? null,
    stock_pool_title: pool?.title ?? null,
  };
}

export type InventoryListEntry<T> =
  | { kind: "product"; product: T }
  | { kind: "pool"; id: string; title: string; members: T[] };

export function groupInventoryByStockPool<
  T extends {
    id: string;
    title: string;
    stock_pool_id?: string | null;
    stock_pool_title?: string | null;
  },
>(products: T[]): InventoryListEntry<T>[] {
  const pools = new Map<string, { title: string; members: T[] }>();
  const singles: T[] = [];

  for (const product of products) {
    const poolId = product.stock_pool_id ?? null;
    if (!poolId) {
      singles.push(product);
      continue;
    }
    const existing = pools.get(poolId);
    if (existing) existing.members.push(product);
    else {
      pools.set(poolId, {
        title: product.stock_pool_title || product.title,
        members: [product],
      });
    }
  }

  for (const pool of Array.from(pools.values())) {
    pool.members.sort((a, b) => a.title.localeCompare(b.title, "nl"));
  }

  const entries: InventoryListEntry<T>[] = [
    ...singles.map((product) => ({ kind: "product" as const, product })),
    ...Array.from(pools.entries()).map(([id, pool]) => ({
      kind: "pool" as const,
      id,
      title: pool.title,
      members: pool.members,
    })),
  ];

  entries.sort((a, b) => {
    const left = a.kind === "pool" ? a.title : a.product.title;
    const right = b.kind === "pool" ? b.title : b.product.title;
    return left.localeCompare(right, "nl");
  });

  return entries;
}

const CABLE_COLOR = /rode motorkabel|zwarte motorkabel|rode kabel|zwarte kabel/i;

/** Korte naam voor een onderliggende voorraad, bijvoorbeeld "Rode motorkabel". */
export function underlyingStockLabel(title: string): string {
  const match = title.match(CABLE_COLOR);
  if (!match) return title;
  const raw = match[0];
  return raw.charAt(0).toLocaleUpperCase("nl-NL") + raw.slice(1);
}
