/**
 * Standaard checklist bij ophaalrit: wat is meegegeven met de fiets.
 * Alleen items met "Ja" worden opgeslagen en later weer afgevinkt bij teruggeven.
 */

export const OPHAAL_MEEGENOMEN_ITEMS = [
  { id: "fietssleutels", label: "Fietssleutels" },
  { id: "accusleutels", label: "Accusleutels" },
  { id: "kettingslotsleutels", label: "Kettingslotsleutels" },
  { id: "lockboxsleutels", label: "Lockboxsleutels" },
  {
    id: "nfc_kaarten",
    label: "NFC-kaarten (inclusief die voor het activeren van het display)",
  },
] as const;

export type OphaalMeegenomenItemId =
  (typeof OPHAAL_MEEGENOMEN_ITEMS)[number]["id"];

export type OphaalMeegenomenAntwoord = "ja" | "nvt";

const ID_SET = new Set<string>(OPHAAL_MEEGENOMEN_ITEMS.map((i) => i.id));

export function ophaalMeegenomenLabel(id: string): string {
  const found = OPHAAL_MEEGENOMEN_ITEMS.find((i) => i.id === id);
  return found?.label ?? id;
}

/** Normaliseer opgeslagen JSON → geldige item-ids (volgorde = standaardlijst). */
export function parseOphalenMeegenomenJson(
  raw: unknown
): OphaalMeegenomenItemId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string" && ID_SET.has(entry)) {
      set.add(entry);
      continue;
    }
    if (entry && typeof entry === "object") {
      const id = String((entry as { id?: unknown }).id ?? "").trim();
      if (ID_SET.has(id)) set.add(id);
    }
  }
  return OPHAAL_MEEGENOMEN_ITEMS.map((i) => i.id).filter((id) =>
    set.has(id)
  ) as OphaalMeegenomenItemId[];
}

/**
 * Body bij afronden ophaal: object id → "ja" | "nvt".
 * Alle standaarditems moeten een antwoord hebben.
 * Retourneert de ids met "ja".
 */
export function resolveMeegenomenFromAntwoorden(
  raw: unknown
): { ok: true; meegenomen: OphaalMeegenomenItemId[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "Vul voor elk meeneem-item Ja of Niet van toepassing in.",
    };
  }
  const map = raw as Record<string, unknown>;
  const meegenomen: OphaalMeegenomenItemId[] = [];
  for (const item of OPHAAL_MEEGENOMEN_ITEMS) {
    const v = String(map[item.id] ?? "")
      .trim()
      .toLowerCase();
    if (v === "ja") {
      meegenomen.push(item.id);
    } else if (v === "nvt" || v === "n.v.t." || v === "niet van toepassing") {
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
  expected: string[],
  raw: unknown
): { ok: true } | { ok: false; error: string } {
  if (expected.length === 0) return { ok: true };

  const given = new Set<string>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const id = String(entry ?? "").trim();
      if (id) given.add(id);
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === true || v === "true" || v === 1 || v === "1" || v === "ja") {
        given.add(k);
      }
    }
  }

  const missing = expected.filter((id) => !given.has(id));
  if (missing.length > 0) {
    const labels = missing.map(ophaalMeegenomenLabel).join(", ");
    return {
      ok: false,
      error: `Vink af dat dit weer is teruggegeven: ${labels}.`,
    };
  }
  return { ok: true };
}
