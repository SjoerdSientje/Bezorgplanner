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

export type ReparatieStandaardItem = {
  id: string;
  owner_email: string;
  naam: string;
  onderdeel_naam: string | null;
  onderdeel_prijs_incl: number;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
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

export type ReparatieRegelInput = {
  kind: "standaard" | "custom" | "voorrijkosten";
  /** Standaard-reparatie id (alleen kind=standaard). */
  standaard_id?: string | null;
  naam: string;
  onderdeel_naam?: string | null;
  onderdeel_prijs_incl?: number | null;
  shopify_product_id?: number | null;
  shopify_variant_id?: number | null;
  arbeid_uren?: number | null;
  /** Voorrijkosten bedrag incl. (meestal 21%). */
  voorrij_bedrag?: number | null;
};

/** Bouw Shopify-achtige line items: onderdelen 21%, arbeid 9% (titel Arbeidskosten…), voorrij 21%. */
export function buildReparatieShopifyLineItems(regels: ReparatieRegelInput[]): ShopifyLineItem[] {
  const out: ShopifyLineItem[] = [];

  for (const r of regels) {
    if (r.kind === "voorrijkosten") {
      const bedrag = Number(r.voorrij_bedrag ?? 0);
      if (bedrag < 0.01) continue;
      out.push({
        name: "Voorrijkosten",
        price: bedrag,
        quantity: 1,
        properties: [],
      });
      continue;
    }

    const onderdeelPrijs = Number(r.onderdeel_prijs_incl ?? 0);
    const onderdeelNaam = String(r.onderdeel_naam ?? r.naam ?? "").trim();
    if (onderdeelNaam && onderdeelPrijs >= 0.01) {
      out.push({
        name: onderdeelNaam,
        price: onderdeelPrijs,
        quantity: 1,
        properties: [],
        product_id: r.shopify_product_id ?? undefined,
        variant_id: r.shopify_variant_id ?? undefined,
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
        arbeid_uren: Number(r.arbeid_uren) || 0,
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
        arbeid_uren: Number(r.arbeid_uren) || 0,
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
