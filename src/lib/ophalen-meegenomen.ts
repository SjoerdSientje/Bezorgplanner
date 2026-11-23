/**
 * Standaard checklist bij ophaalrit: wat is meegegeven met de fiets.
 * Alleen items met "Ja" worden opgeslagen (met aantal) en later weer afgevinkt.
 */

export type OphaalMeegenomenAantal = 1 | 2;

export const OPHAAL_MEEGENOMEN_ITEMS = [
  {
    id: "ringslotsleutels",
    label: "Ringslotsleutels",
    unitSingular: "sleutel",
    unitPlural: "sleutels",
  },
  {
    id: "accusleutels",
    label: "Accusleutels",
    unitSingular: "sleutel",
    unitPlural: "sleutels",
  },
  {
    id: "kettingslotsleutels",
    label: "Kettingslotsleutels",
    unitSingular: "sleutel",
    unitPlural: "sleutels",
  },
  {
    id: "lockboxsleutels",
    label: "Lockboxsleutels",
    unitSingular: "sleutel",
    unitPlural: "sleutels",
  },
  {
    id: "accu",
    label: "Accu",
    unitSingular: "accu",
    unitPlural: "accu's",
  },
  {
    id: "nfc_kaarten",
    label: "NFC-kaarten (inclusief die voor het activeren van het display)",
    unitSingular: "NFC-kaart",
    unitPlural: "NFC-kaarten",
  },
] as const;

export type OphaalMeegenomenItemId =
  (typeof OPHAAL_MEEGENOMEN_ITEMS)[number]["id"];

export type OphaalMeegenomenAntwoord = "ja" | "nvt";

export type OphaalMeegenomenEntry = {
  id: OphaalMeegenomenItemId;
  aantal: OphaalMeegenomenAantal;
};

/** Oude id → huidige id (bestaande opgeslagen data). */
const LEGACY_ID_MAP: Record<string, OphaalMeegenomenItemId> = {
  fietssleutels: "ringslotsleutels",
};

const ID_SET = new Set<string>(OPHAAL_MEEGENOMEN_ITEMS.map((i) => i.id));

function normalizeItemId(raw: string): OphaalMeegenomenItemId | null {
  const id = String(raw ?? "").trim();
  if (!id) return null;
  if (ID_SET.has(id)) return id as OphaalMeegenomenItemId;
  const mapped = LEGACY_ID_MAP[id];
  return mapped ?? null;
}

function parseAantal(raw: unknown): OphaalMeegenomenAantal {
  const n =
    typeof raw === "number"
      ? raw
      : parseInt(String(raw ?? "").trim(), 10);
  return n === 2 ? 2 : 1;
}

export function ophaalMeegenomenLabel(id: string): string {
  const normalized = normalizeItemId(id) ?? id;
  const found = OPHAAL_MEEGENOMEN_ITEMS.find((i) => i.id === normalized);
  return found?.label ?? normalized;
}

/** Label inclusief aantal, bijv. "Ringslotsleutels (2 meegenomen)". */
export function ophaalMeegenomenEntryLabel(
  entry: OphaalMeegenomenEntry | OphaalMeegenomenItemId | string
): string {
  if (typeof entry === "string") {
    return ophaalMeegenomenLabel(entry);
  }
  const base = ophaalMeegenomenLabel(entry.id);
  const item = OPHAAL_MEEGENOMEN_ITEMS.find((i) => i.id === entry.id);
  const unit =
    entry.aantal === 1
      ? item?.unitSingular ?? "stuk"
      : item?.unitPlural ?? "stuks";
  return `${base} (${entry.aantal} ${unit} meegenomen)`;
}

export function ophaalMeegenomenAantalOpties(itemId: OphaalMeegenomenItemId): [
  { value: 1; label: string },
  { value: 2; label: string },
] {
  const item = OPHAAL_MEEGENOMEN_ITEMS.find((i) => i.id === itemId);
  const singular = item?.unitSingular ?? "stuk";
  const plural = item?.unitPlural ?? "stuks";
  return [
    { value: 1, label: `1 ${singular} meegenomen` },
    { value: 2, label: `2 ${plural} meegenomen` },
  ];
}

export function meegenomenEntryIds(
  entries: OphaalMeegenomenEntry[]
): OphaalMeegenomenItemId[] {
  return entries.map((e) => e.id);
}

/**
 * Normaliseer opgeslagen JSON → entries met id + aantal.
 * Accepteert legacy string[] en objecten met/zonder aantal.
 */
export function parseOphalenMeegenomenJson(
  raw: unknown
): OphaalMeegenomenEntry[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<OphaalMeegenomenItemId, OphaalMeegenomenAantal>();
  for (const entry of raw) {
    if (typeof entry === "string") {
      const id = normalizeItemId(entry);
      if (id) byId.set(id, byId.get(id) ?? 1);
      continue;
    }
    if (entry && typeof entry === "object") {
      const id = normalizeItemId(
        String((entry as { id?: unknown }).id ?? "").trim()
      );
      if (!id) continue;
      const aantal = parseAantal(
        (entry as { aantal?: unknown; count?: unknown }).aantal ??
          (entry as { count?: unknown }).count
      );
      byId.set(id, aantal);
    }
  }
  return OPHAAL_MEEGENOMEN_ITEMS.map((i) => i.id)
    .filter((id) => byId.has(id))
    .map((id) => ({ id, aantal: byId.get(id)! }));
}

/**
 * Body bij afronden ophaal: object id → "ja" | "nvt",
 * of id → { antwoord/status: "ja"|"nvt", aantal?: 1|2 }.
 * Optioneel parallel: id_aantal of apart object ophalen_meegenomen_aantal
 * (via resolveMeegenomenFromAntwoorden tweede arg).
 */
export function resolveMeegenomenFromAntwoorden(
  raw: unknown,
  aantallenRaw?: unknown
):
  | { ok: true; meegenomen: OphaalMeegenomenEntry[] }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "Vul voor elk meeneem-item Ja of Niet van toepassing in.",
    };
  }
  const map = raw as Record<string, unknown>;
  const aantalMap =
    aantallenRaw && typeof aantallenRaw === "object" && !Array.isArray(aantallenRaw)
      ? (aantallenRaw as Record<string, unknown>)
      : {};

  const meegenomen: OphaalMeegenomenEntry[] = [];
  for (const item of OPHAAL_MEEGENOMEN_ITEMS) {
    const cell = map[item.id];
    let antwoord = "";
    let aantalFromCell: unknown;

    if (cell && typeof cell === "object" && !Array.isArray(cell)) {
      const o = cell as Record<string, unknown>;
      antwoord = String(o.antwoord ?? o.status ?? o.value ?? "")
        .trim()
        .toLowerCase();
      aantalFromCell = o.aantal ?? o.count;
    } else {
      antwoord = String(cell ?? "")
        .trim()
        .toLowerCase();
    }

    if (antwoord === "ja") {
      const rawAantal =
        aantalFromCell ??
        aantalMap[item.id] ??
        map[`${item.id}_aantal`] ??
        map[`${item.id}Aantal`];
      if (rawAantal == null || rawAantal === "") {
        return {
          ok: false,
          error: `Kies hoeveel er meegenomen zijn voor: ${item.label}.`,
        };
      }
      const n =
        typeof rawAantal === "number"
          ? rawAantal
          : parseInt(String(rawAantal).trim(), 10);
      if (n !== 1 && n !== 2) {
        return {
          ok: false,
          error: `Kies 1 of 2 voor: ${item.label}.`,
        };
      }
      meegenomen.push({ id: item.id, aantal: n });
    } else if (
      antwoord === "nvt" ||
      antwoord === "n.v.t." ||
      antwoord === "niet van toepassing"
    ) {
      // skip
    } else {
      return {
        ok: false,
        error: `Kies Ja of Niet van toepassing voor: ${item.label}.`,
      };
    }
  }
  return { ok: true, meegenomen };
}

/**
 * Body bij teruggeven: array van ids die aangevinkt zijn,
 * of object id → true. Alle verwachte ids moeten aanwezig zijn.
 */
export function assertMeegenomenTeruggegeven(
  expected: Array<OphaalMeegenomenEntry | string>,
  raw: unknown
): { ok: true } | { ok: false; error: string } {
  const expectedIds = expected
    .map((e) => (typeof e === "string" ? e : e.id))
    .map((id) => normalizeItemId(id) ?? id)
    .filter(Boolean);
  if (expectedIds.length === 0) return { ok: true };

  const given = new Set<string>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") {
        const id = normalizeItemId(entry) ?? entry.trim();
        if (id) given.add(id);
        continue;
      }
      if (entry && typeof entry === "object") {
        const id = normalizeItemId(
          String((entry as { id?: unknown }).id ?? "").trim()
        );
        if (id) given.add(id);
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === true || v === "true" || v === 1 || v === "1" || v === "ja") {
        const id = normalizeItemId(k) ?? k;
        given.add(id);
      }
    }
  }

  const missing = expectedIds.filter((id) => !given.has(id));
  if (missing.length > 0) {
    const labels = missing.map(ophaalMeegenomenLabel).join(", ");
    return {
      ok: false,
      error: `Vink af dat dit weer is teruggegeven: ${labels}.`,
    };
  }
  return { ok: true };
}
