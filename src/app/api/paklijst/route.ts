import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { isOrderReadyForSjoerdLijst } from "@/lib/planning-date";
import { filterOutPausedMpOrders, isMpPausedForOwner } from "@/lib/mp-pause";
import {
  DEFAULT_PRODUCT_RULES_V2,
  getDefaultItemsForFiets,
  normalizeProductDefaultItemsRules,
  type ProductDefaultItemsRulesV2,
} from "@/lib/product-default-items-rules";

export const dynamic = "force-dynamic";

export type PaklijstScope = "sjoerd" | "planning";

interface LineItemFromJson {
  name: string;
  price: number;
  isFiets: boolean;
  properties?: { name: string; value: string }[];
  defaultItems?: string[];
}

interface OrderDetail {
  id: string;
  order_nummer: string | number | null;
  naam: string | null;
  volledig_adres: string | null;
  aankomsttijd_slot: string | null;
  telefoon_nummer: string | null;
  bestelling_totaal_prijs: number | null;
  betaald: boolean | null;
  products: LineItemFromJson[];
}

function shouldIgnorePaklijstItemName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (n === "volledig rijklaar") return true;
  if (n === "rijklaar") return true;
  if (n === "in doos") return true;
  return false;
}

function parseProductsTextFallback(producten: unknown): LineItemFromJson[] {
  return String(producten ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      price: 0,
      isFiets: false,
      properties: [],
      defaultItems: [],
    }));
}

/** Zelfde naleveren/garantie-uitsluiting als ritjes-vandaag. */
const NALEVEREN_START_RE = /^\s*(naleveren|nalevering|garantie)\s*:/i;
function isNaleverenOrder(o: Record<string, unknown>): boolean {
  const prijs = parseFloat(String(o.bestelling_totaal_prijs ?? 0));
  if (prijs > 0) return false;
  const producten = String(o.producten ?? "");
  const opmerkingen = String(o.opmerkingen_klant ?? "");
  return NALEVEREN_START_RE.test(producten) || NALEVEREN_START_RE.test(opmerkingen);
}

/** Haal opgeslagen product-rules op, val terug op hardcoded defaults. */
async function loadProductRules(ownerEmail: string): Promise<ProductDefaultItemsRulesV2> {
  try {
    const supabase = createServerSupabaseClient();
    const { data: row } = await supabase
      .from("product_default_items_rules")
      .select("rules")
      .eq("owner_email", ownerEmail)
      .eq("id", "default")
      .maybeSingle();
    if (row?.rules != null) return normalizeProductDefaultItemsRules(row.rules);
  } catch {
    /* gebruik default */
  }
  return DEFAULT_PRODUCT_RULES_V2;
}

/** Herbereken defaultItems voor een fiets-item vanuit actuele rules. */
function liveDefaultItems(
  item: LineItemFromJson,
  rules: ProductDefaultItemsRulesV2
): string[] {
  if (!item.isFiets) return [];
  return getDefaultItemsForFiets(item.name, item.properties ?? [], rules);
}

function parseScope(raw: string | null): PaklijstScope {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "planning" || s === "routes") return "planning";
  return "sjoerd";
}

/**
 * GET /api/paklijst?scope=sjoerd|planning
 * - sjoerd: zelfde pool als Lijst Sjoerd (niet in actieve planning_slots)
 * - planning: alle orders met een actieve planning_slot
 */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    const supabase = createServerSupabaseClient();
    const mpPaused = await isMpPausedForOwner(supabase, ownerEmail);
    const productRules = await loadProductRules(ownerEmail);

    const { data: activeSlots, error: slotsErr } = await supabase
      .from("planning_slots")
      .select("order_id, aankomsttijd")
      .eq("owner_email", ownerEmail)
      .neq("status", "afgerond");

    if (slotsErr) {
      console.error("[api/paklijst] slots", slotsErr);
      return NextResponse.json({ error: "Genereren mislukt." }, { status: 500 });
    }

    const slotAankomstByOrderId = new Map<string, string>();
    for (const s of activeSlots ?? []) {
      const id = String((s as { order_id?: string }).order_id ?? "").trim();
      if (!id) continue;
      const t = String((s as { aankomsttijd?: string }).aankomsttijd ?? "").trim();
      if (t && !slotAankomstByOrderId.has(id)) slotAankomstByOrderId.set(id, t);
      else if (!slotAankomstByOrderId.has(id)) slotAankomstByOrderId.set(id, "");
    }
    const plannedIds = new Set(slotAankomstByOrderId.keys());

    let orders: Record<string, unknown>[] = [];

    if (scope === "planning") {
      const ids = Array.from(plannedIds);
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from("orders")
          .select("*")
          .eq("owner_email", ownerEmail)
          .in("id", ids);
        if (error) {
          console.error("[api/paklijst] planning orders", error);
          return NextResponse.json({ error: "Genereren mislukt." }, { status: 500 });
        }
        orders = filterOutPausedMpOrders(
          (data ?? []) as Record<string, unknown>[],
          mpPaused
        ).filter((o) => {
          const st = String(o.status ?? "");
          return st === "ritjes_vandaag" || st === "gepland";
        });
      }
    } else {
      // Serverside filter — nooit select(*) zonder WHERE (PostgREST max ~1000 rijen).
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("owner_email", ownerEmail)
        .eq("status", "ritjes_vandaag")
        .eq("meenemen_in_planning", true)
        .is("afgerond_at", null);
      if (error) {
        console.error("[api/paklijst]", error);
        return NextResponse.json({ error: "Genereren mislukt." }, { status: 500 });
      }
      orders = filterOutPausedMpOrders(
        (data ?? []) as Record<string, unknown>[],
        mpPaused
      ).filter((o) => {
        if (!isOrderReadyForSjoerdLijst(o)) return false;
        if (isNaleverenOrder(o)) return false;
        // Lijst Sjoerd toont geen orders die al in Routes/planning staan
        if (plannedIds.has(String(o.id ?? ""))) return false;
        return true;
      });
    }

    // ── Per-order detail blokken ──────────────────────────────────────────
    const ordersDetail: OrderDetail[] = orders.map((order) => {
      let products: LineItemFromJson[] = [];
      try {
        if (order.line_items_json) {
          products = JSON.parse(order.line_items_json as string) as LineItemFromJson[];
        }
      } catch {
        /* ignore */
      }
      if (products.length === 0) {
        products = parseProductsTextFallback(order.producten);
      }

      const id = String(order.id);
      const slotFromPlanning = slotAankomstByOrderId.get(id);
      const aankomst =
        (slotFromPlanning && slotFromPlanning.trim()) ||
        (order.aankomsttijd_slot as string | null) ||
        null;

      return {
        id,
        order_nummer: (order.order_nummer as string | number | null) ?? null,
        naam: (order.naam as string | null) ?? null,
        volledig_adres: (order.volledig_adres as string | null) ?? null,
        aankomsttijd_slot: aankomst,
        telefoon_nummer: (order.telefoon_nummer as string | null) ?? null,
        bestelling_totaal_prijs:
          typeof order.bestelling_totaal_prijs === "number"
            ? order.bestelling_totaal_prijs
            : null,
        betaald: typeof order.betaald === "boolean" ? order.betaald : null,
        products,
      };
    });

    ordersDetail.sort((a, b) => {
      const ta = a.aankomsttijd_slot ?? "";
      const tb = b.aankomsttijd_slot ?? "";
      return ta.localeCompare(tb);
    });

    // ── Samenvattende paklijst ────────────────────────────────────────────
    const counts: Record<string, number> = {};
    const add = (naam: string) => {
      const n = naam.trim();
      if (!n) return;
      if (shouldIgnorePaklijstItemName(n)) return;
      counts[n] = (counts[n] ?? 0) + 1;
    };

    for (const order of orders) {
      const raw = order.line_items_json as string | null | undefined;
      let items: LineItemFromJson[] = [];
      if (raw) {
        try {
          items = JSON.parse(raw) as LineItemFromJson[];
        } catch {
          /* ignore */
        }
      }
      if (items.length === 0) {
        items = parseProductsTextFallback(order.producten);
      }

      for (const item of items) {
        if (!item.isFiets) {
          add(item.name);
        } else {
          for (const d of liveDefaultItems(item, productRules)) {
            add(d);
          }
        }
      }
    }

    const summaryItems = Object.entries(counts)
      .sort(([nameA, cntA], [nameB, cntB]) => cntB - cntA || nameA.localeCompare(nameB, "nl"))
      .map(([name, count]) => ({ name, count }));

    return NextResponse.json(
      {
        scope,
        orders: ordersDetail,
        items: summaryItems,
        orderCount: orders.length,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/paklijst]", e);
    return NextResponse.json({ error: "Genereren mislukt." }, { status: 500 });
  }
}
