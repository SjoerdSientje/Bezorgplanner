/**
 * Reparaties: prijzenlijst, voorrijkosten, line-items, order helpers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShopifyLineItem } from "@/lib/shopify-order";
import { buildLineItemsJson } from "@/lib/shopify-order";
import { DEPOT_ADDRESS } from "@/lib/routific-payload";
import { getPointToPointDistanceKm } from "@/lib/google-travel-times";

/** Arbeidsuur incl. 9% BTW (€45 excl.). */
export const ARBEID_UUR_PRIJS_INCL = 49.05;

export type ReparatieSoort = "reparatie_deur" | "reparatie_ophalen" | "reparatie_terugbrengen";
export type ReparatieBetaalwijze = "contant" | "factuur";

/** Productregels (Shopify + arbeid) gelden voor aan-huis én terugbrengen. */
export function reparatieSoortHeeftProducten(soort: ReparatieSoort): boolean {
  return soort === "reparatie_deur" || soort === "reparatie_terugbrengen";
}

export type ReparatieOnderdeel = {
  naam: string;
  prijs_incl: number;
  shopify_product_id?: number | null;
  shopify_variant_id?: number | null;
};

export type ReparatieStandaardItem = {
  id: string;
  owner_email: string;
  naam: string;
  onderdeel_naam: string | null;
  onderdeel_prijs_incl: number;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
  /** Meerdere Shopify-onderdelen; leeg = legacy enkelveld. */
  onderdelen_json?: ReparatieOnderdeel[] | null;
  arbeid_uren: number;
  sort_order: number;
  active: boolean;
};

export type VoorrijkostenSettings = {
  owner_email: string;
  basis_eur: number;
  per_km_eur: number;
  afronding_eur: number;
};

export const DEFAULT_VOORRIJKOSTEN: Omit<VoorrijkostenSettings, "owner_email"> = {
  basis_eur: 25,
  per_km_eur: 1,
  afronding_eur: 5,
};

/** Afronden op dichtstbijzijnde stap (standaard €5): 32→30, 33→35. */
export function roundToNearestStep(amount: number, step = 5): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const s = step > 0 ? step : 5;
  return Math.round(amount / s) * s;
}

export function calcVoorrijkosten(
  km: number,
  settings: Pick<VoorrijkostenSettings, "basis_eur" | "per_km_eur" | "afronding_eur">
): { raw: number; rounded: number; km: number } {
  const distance = Math.max(0, Number(km) || 0);
  const raw = settings.basis_eur + distance * settings.per_km_eur;
  return {
    km: Math.round(distance * 10) / 10,
    raw: Math.round(raw * 100) / 100,
    rounded: roundToNearestStep(raw, settings.afronding_eur),
  };
}

export function arbeidPrijsIncl(uren: number): number {
  const u = Math.max(0, Number(uren) || 0);
  return Math.round(u * ARBEID_UUR_PRIJS_INCL * 100) / 100;
}

/** Arbeidskosten incl. → uren (omgekeerde van arbeidPrijsIncl). */
export function arbeidUrenFromPrijsIncl(prijsIncl: number): number {
  const p = Math.max(0, Number(prijsIncl) || 0);
  if (p < 0.01 || ARBEID_UUR_PRIJS_INCL <= 0) return 0;
  return Math.round((p / ARBEID_UUR_PRIJS_INCL) * 10000) / 10000;
}

export type ReparatieRegelInput = {
  kind: "standaard" | "custom" | "voorrijkosten";
  /** Standaard-reparatie id (alleen kind=standaard). */
  standaard_id?: string | null;
  naam: string;
  onderdeel_naam?: string | null;
  onderdeel_prijs_incl?: number | null;
  shopify_product_id?: number | null;
  shopify_variant_id?: number | null;
  /** Meerdere onderdelen (standaardreparatie of custom). */
  onderdelen?: ReparatieOnderdeel[] | null;
  arbeid_uren?: number | null;
  /** Voorrijkosten bedrag incl. (meestal 21%). */
  voorrij_bedrag?: number | null;
  /**
   * Vrije tekst voor de productenkolom (niet op de factuur).
   * Leeg → fallback op standaardnaam / onderdeelnaam.
   */
  kolom_tekst?: string | null;
};

/** Prefix bovenaan de productenkolom per ordertype. */
export function reparatieSoortProductenPrefix(soort: ReparatieSoort): string {
  switch (soort) {
    case "reparatie_ophalen":
      return "Ophalen:";
    case "reparatie_deur":
      return "Reparatie aan huis:";
    case "reparatie_terugbrengen":
      return "Terugbrengen:";
    default:
      return "Reparatie:";
  }
}

/** Bouw productenkolom: altijd prefix, daarna vrije tekst of per-regel kolomtekst. */
export function buildReparatieProductenKolom(params: {
  soort: ReparatieSoort;
  vrijeTekst?: string | null;
  regels?: Array<{
    kolom_tekst?: string | null;
    naam?: string | null;
    onderdeel_naam?: string | null;
  }>;
}): string {
  const prefix = reparatieSoortProductenPrefix(params.soort);
  const lines: string[] = [prefix];
  const vrij = String(params.vrijeTekst ?? "").trim();
  if (vrij) {
    lines.push(vrij);
    return lines.join("\n");
  }
  for (const r of params.regels ?? []) {
    const custom = String(r.kolom_tekst ?? "").trim();
    if (custom) {
      lines.push(custom);
      continue;
    }
    const fallback = String(r.naam || r.onderdeel_naam || "").trim();
    if (fallback) lines.push(fallback);
  }
  return lines.join("\n");
}

/** Haal prefix weg om vrije tekst / rest terug te krijgen bij bewerken. */
export function stripReparatieProductenPrefix(
  producten: string | null | undefined,
  soort: ReparatieSoort
): string {
  const raw = String(producten ?? "");
  const prefix = reparatieSoortProductenPrefix(soort);
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length).replace(/^\n+/, "").trim();
  }
  return raw.trim();
}

/** Pas totaalprijs-override toe op onderdelen zonder Shopify-ids te wijzigen. */
export function applyOnderdelenPrijsOverride(
  onderdelen: ReparatieOnderdeel[],
  overrideTotal: number | null | undefined
): ReparatieOnderdeel[] {
  if (overrideTotal == null || !Number.isFinite(Number(overrideTotal))) {
    return onderdelen.map((o) => ({ ...o }));
  }
  const target = Math.max(0, Number(overrideTotal));
  if (onderdelen.length === 0) return [];
  if (onderdelen.length === 1) {
    return [{ ...onderdelen[0]!, prijs_incl: target }];
  }
  const sum = onderdelen.reduce((s, o) => s + (Number(o.prijs_incl) || 0), 0);
  if (sum < 0.01) {
    return onderdelen.map((o, i) =>
      i === 0 ? { ...o, prijs_incl: target } : { ...o, prijs_incl: 0 }
    );
  }
  return onderdelen.map((o) => ({
    ...o,
    prijs_incl:
      Math.round(((Number(o.prijs_incl) || 0) / sum) * target * 100) / 100,
  }));
}

/**
 * Expand ruwe form-regels naar opslag/factuur-regels.
 * Standaard: behoud Shopify-koppelingen; prijs/uren/kolom_tekst mogen overriden.
 */
export function expandReparatieRegelsFromInput(
  rawRegels: ReparatieRegelInput[],
  standaardById: Map<string, ReparatieStandaardItem>
): ReparatieRegelInput[] {
  const expanded: ReparatieRegelInput[] = [];
  for (const r of rawRegels) {
    if (r.kind === "standaard" && r.standaard_id) {
      const s = standaardById.get(String(r.standaard_id));
      if (!s) continue;
      const baseOnderdelen = normalizeStandaardOnderdelen(s);
      const hasPrijsOverride =
        r.onderdeel_prijs_incl != null &&
        Number.isFinite(Number(r.onderdeel_prijs_incl));
      const onderdelen = hasPrijsOverride
        ? applyOnderdelenPrijsOverride(baseOnderdelen, Number(r.onderdeel_prijs_incl))
        : baseOnderdelen.map((o) => ({ ...o }));
      const legacy = legacyFieldsFromOnderdelen(onderdelen);
      const hasUrenOverride =
        r.arbeid_uren != null && Number.isFinite(Number(r.arbeid_uren));
      expanded.push({
        kind: "standaard",
        standaard_id: s.id,
        naam: s.naam,
        onderdeel_naam: legacy.onderdeel_naam || s.naam,
        onderdeel_prijs_incl: legacy.onderdeel_prijs_incl,
        shopify_product_id: legacy.shopify_product_id,
        shopify_variant_id: legacy.shopify_variant_id,
        onderdelen,
        arbeid_uren: hasUrenOverride
          ? Math.max(0, Number(r.arbeid_uren) || 0)
          : Number(s.arbeid_uren) || 0,
        kolom_tekst: String(r.kolom_tekst ?? "").trim() || null,
      });
    } else if (r.kind === "custom") {
      expanded.push({
        kind: "custom",
        naam: String(r.naam ?? "").trim() || "Reparatie",
        onderdeel_naam: String(r.onderdeel_naam ?? r.naam ?? "").trim(),
        onderdeel_prijs_incl: Math.max(0, Number(r.onderdeel_prijs_incl) || 0),
        shopify_product_id: r.shopify_product_id ?? null,
        shopify_variant_id: r.shopify_variant_id ?? null,
        arbeid_uren: Math.max(0, Number(r.arbeid_uren) || 0),
        kolom_tekst: String(r.kolom_tekst ?? "").trim() || null,
      });
    }
  }
  return expanded;
}

/** Parse/normalize onderdelen uit standaarditem (nieuw of legacy enkelveld). */
export function normalizeStandaardOnderdelen(
  item: Pick<
    ReparatieStandaardItem,
    | "naam"
    | "onderdeel_naam"
    | "onderdeel_prijs_incl"
    | "shopify_product_id"
    | "shopify_variant_id"
    | "onderdelen_json"
  >
): ReparatieOnderdeel[] {
  const raw = item.onderdelen_json;
  if (Array.isArray(raw) && raw.length > 0) {
    const out: ReparatieOnderdeel[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const r = entry as Record<string, unknown>;
      const naam = String(r.naam ?? "").trim();
      if (!naam) continue;
      out.push({
        naam,
        prijs_incl: Math.max(0, Number(r.prijs_incl) || 0),
        shopify_product_id:
          r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
        shopify_variant_id:
          r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
      });
    }
    if (out.length > 0) return out;
  }
  const naam = String(item.onderdeel_naam || item.naam || "").trim();
  if (!naam && item.shopify_product_id == null) return [];
  return [
    {
      naam: naam || "Onderdeel",
      prijs_incl: Math.max(0, Number(item.onderdeel_prijs_incl) || 0),
      shopify_product_id: item.shopify_product_id ?? null,
      shopify_variant_id: item.shopify_variant_id ?? null,
    },
  ];
}

/** Totaal incl. BTW voor een standaardreparatie (onderdelen + arbeid). */
export function standaardReparatieTotaalIncl(
  item: Pick<
    ReparatieStandaardItem,
    | "naam"
    | "onderdeel_naam"
    | "onderdeel_prijs_incl"
    | "shopify_product_id"
    | "shopify_variant_id"
    | "onderdelen_json"
    | "arbeid_uren"
  >
): number {
  const onderdelen = normalizeStandaardOnderdelen(item);
  const onderdelenPrijs = onderdelen.reduce((sum, o) => sum + (o.prijs_incl || 0), 0);
  const totaal = onderdelenPrijs + arbeidPrijsIncl(item.arbeid_uren);
  return Math.round(totaal * 100) / 100;
}

export function parseOnderdelenInput(raw: unknown): ReparatieOnderdeel[] {
  if (!Array.isArray(raw)) return [];
  const out: ReparatieOnderdeel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const naam = String(r.naam ?? r.onderdeel_naam ?? "").trim();
    if (!naam) continue;
    out.push({
      naam,
      prijs_incl: Math.max(0, Number(r.prijs_incl ?? r.onderdeel_prijs_incl) || 0),
      shopify_product_id:
        r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
      shopify_variant_id:
        r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
    });
  }
  return out;
}

/** Legacy enkelvelden synchroon houden met onderdelenlijst. */
export function legacyFieldsFromOnderdelen(onderdelen: ReparatieOnderdeel[]): {
  onderdeel_naam: string | null;
  onderdeel_prijs_incl: number;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
} {
  const first = onderdelen[0];
  return {
    onderdeel_naam:
      onderdelen.map((o) => o.naam).filter(Boolean).join(" + ") || null,
    onderdeel_prijs_incl: Math.round(
      onderdelen.reduce((sum, o) => sum + (Number(o.prijs_incl) || 0), 0) * 100
    ) / 100,
    shopify_product_id: first?.shopify_product_id ?? null,
    shopify_variant_id: first?.shopify_variant_id ?? null,
  };
}

/** Bouw Shopify-achtige line items: onderdelen 21%, arbeid 9% (titel Arbeidskosten…), voorrij 21%. */
export function buildReparatieShopifyLineItems(regels: ReparatieRegelInput[]): ShopifyLineItem[] {
  const out: ShopifyLineItem[] = [];

  for (const r of regels) {
    if (r.kind === "voorrijkosten") {
      const bedrag = Number(r.voorrij_bedrag ?? 0);
      if (bedrag < 0.01) continue;
      out.push({
        name: String(r.naam ?? "Voorrijkosten").trim() || "Voorrijkosten",
        price: bedrag,
        quantity: 1,
        properties: [],
      });
      continue;
    }

    const onderdelen: ReparatieOnderdeel[] =
      Array.isArray(r.onderdelen) && r.onderdelen.length > 0
        ? r.onderdelen
        : (() => {
            const onderdeelNaam = String(r.onderdeel_naam ?? r.naam ?? "").trim();
            const onderdeelPrijs = Number(r.onderdeel_prijs_incl ?? 0);
            if (!onderdeelNaam) return [];
            return [
              {
                naam: onderdeelNaam,
                prijs_incl: onderdeelPrijs,
                shopify_product_id: r.shopify_product_id ?? null,
                shopify_variant_id: r.shopify_variant_id ?? null,
              },
            ];
          })();

    for (const o of onderdelen) {
      const naam = String(o.naam ?? "").trim();
      if (!naam) continue;
      // €0 mag (garantie) — Shopify-koppeling blijft behouden.
      const prijs = Math.max(0, Number(o.prijs_incl ?? 0) || 0);
      out.push({
        name: naam,
        price: prijs,
        quantity: 1,
        properties: [],
        product_id: o.shopify_product_id ?? undefined,
        variant_id: o.shopify_variant_id ?? undefined,
      });
    }

    const uren = Number(r.arbeid_uren ?? 0);
    const arbeid = arbeidPrijsIncl(uren);
    if (arbeid >= 0.01) {
      const label = String(r.naam ?? "").trim() || "reparatie";
      out.push({
        name: `Arbeidskosten ${label}`,
        price: arbeid,
        quantity: 1,
        properties: [{ name: "Uren", value: String(uren) }],
      });
    }
  }

  return out;
}

export function sumLineItemsIncl(items: ShopifyLineItem[]): number {
  return items.reduce((sum, li) => {
    const qty = Math.max(1, Math.floor(Number(li.quantity ?? 1)));
    const price = typeof li.price === "number" ? li.price : parseFloat(String(li.price ?? 0));
    return sum + (Number.isFinite(price) ? price * qty : 0);
  }, 0);
}

export function productenTekstFromLineItems(items: ShopifyLineItem[]): string {
  return items
    .map((li) => {
      const qty = Math.max(1, Math.floor(Number(li.quantity ?? 1)));
      const name = String(li.name ?? "").trim();
      if (!name) return "";
      return qty > 1 ? `${qty}× ${name}` : name;
    })
    .filter(Boolean)
    .join("\n");
}

export function buildReparatieLineItemsJson(items: ShopifyLineItem[]) {
  return buildLineItemsJson({ line_items: items });
}

export async function loadVoorrijkostenSettings(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<VoorrijkostenSettings> {
  const { data } = await supabase
    .from("reparatie_voorrijkosten_settings")
    .select("*")
    .eq("owner_email", ownerEmail)
    .maybeSingle();
  if (data) {
    return {
      owner_email: ownerEmail,
      basis_eur: Number(data.basis_eur ?? 25),
      per_km_eur: Number(data.per_km_eur ?? 1),
      afronding_eur: Number(data.afronding_eur ?? 5),
    };
  }
  return { owner_email: ownerEmail, ...DEFAULT_VOORRIJKOSTEN };
}

export async function upsertVoorrijkostenSettings(
  supabase: SupabaseClient,
  ownerEmail: string,
  patch: Partial<Omit<VoorrijkostenSettings, "owner_email">>
): Promise<VoorrijkostenSettings> {
  const current = await loadVoorrijkostenSettings(supabase, ownerEmail);
  const next = {
    owner_email: ownerEmail,
    basis_eur: patch.basis_eur ?? current.basis_eur,
    per_km_eur: patch.per_km_eur ?? current.per_km_eur,
    afronding_eur: patch.afronding_eur ?? current.afronding_eur,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("reparatie_voorrijkosten_settings")
    .upsert(next, { onConflict: "owner_email" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return {
    owner_email: ownerEmail,
    basis_eur: Number(data.basis_eur),
    per_km_eur: Number(data.per_km_eur),
    afronding_eur: Number(data.afronding_eur),
  };
}

export async function listReparatieStandaardItems(
  supabase: SupabaseClient,
  ownerEmail: string,
  opts?: { includeInactive?: boolean }
): Promise<ReparatieStandaardItem[]> {
  let q = supabase
    .from("reparatie_standaard_items")
    .select("*")
    .eq("owner_email", ownerEmail)
    .order("sort_order", { ascending: true })
    .order("naam", { ascending: true });
  if (!opts?.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ReparatieStandaardItem[];
}

/** Afstand depot → adres + voorrijkosten. */
export async function calcVoorrijkostenForAddress(
  supabase: SupabaseClient,
  ownerEmail: string,
  address: string
): Promise<{ km: number; bedrag: number; raw: number; settings: VoorrijkostenSettings }> {
  const settings = await loadVoorrijkostenSettings(supabase, ownerEmail);
  const km = await getPointToPointDistanceKm(DEPOT_ADDRESS, address);
  const calc = calcVoorrijkosten(km, settings);
  return { km: calc.km, bedrag: calc.rounded, raw: calc.raw, settings };
}

/** Regels zonder voorrijkosten — voor opslag in reparatie_regels_json. */
export function stripVoorrijFromRegels(
  regels: ReparatieRegelInput[]
): ReparatieRegelInput[] {
  return regels.filter((r) => r.kind !== "voorrijkosten");
}

export function parseStoredReparatieRegels(raw: unknown): ReparatieRegelInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ReparatieRegelInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const kind = String(r.kind ?? "");
    if (kind === "standaard") {
      out.push({
        kind: "standaard",
        standaard_id: r.standaard_id != null ? String(r.standaard_id) : null,
        naam: String(r.naam ?? ""),
        onderdeel_naam: r.onderdeel_naam != null ? String(r.onderdeel_naam) : null,
        onderdeel_prijs_incl: Number(r.onderdeel_prijs_incl) || 0,
        shopify_product_id:
          r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
        shopify_variant_id:
          r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
        onderdelen: parseOnderdelenInput(r.onderdelen),
        arbeid_uren: Number(r.arbeid_uren) || 0,
        kolom_tekst: r.kolom_tekst != null ? String(r.kolom_tekst) : null,
      });
    } else if (kind === "custom") {
      out.push({
        kind: "custom",
        naam: String(r.naam ?? "Reparatie"),
        onderdeel_naam: r.onderdeel_naam != null ? String(r.onderdeel_naam) : null,
        onderdeel_prijs_incl: Number(r.onderdeel_prijs_incl) || 0,
        shopify_product_id:
          r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
        shopify_variant_id:
          r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
        onderdelen: parseOnderdelenInput(r.onderdelen),
        arbeid_uren: Number(r.arbeid_uren) || 0,
        kolom_tekst: r.kolom_tekst != null ? String(r.kolom_tekst) : null,
      });
    }
  }
  return out;
}

export function reparatieSoortLabel(soort: ReparatieSoort): string {
  switch (soort) {
    case "reparatie_deur":
      return "Reparatie aan huis";
    case "reparatie_ophalen":
      return "Ophalen";
    case "reparatie_terugbrengen":
      return "Terugbrengen";
    default:
      return soort;
  }
}
