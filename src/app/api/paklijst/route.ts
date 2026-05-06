import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import { isDatumOpmerkingVandaagOfMorgen } from "@/lib/planning-date";
import {
  DEFAULT_PRODUCT_RULES_V1,
  applyProductDefaultItemsRules,
  isProductDefaultItemsRulesV1,
  type ProductDefaultItemsRulesV1,
} from "@/lib/product-default-items-rules";

export const dynamic = "force-dynamic";

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

/** Haal opgeslagen product-rules op, val terug op hardcoded defaults. */
async function loadProductRules(ownerEmail: string): Promise<ProductDefaultItemsRulesV1> {
  try {
    const supabase = createServerSupabaseClient();
    const { data: row } = await supabase
      .from("product_default_items_rules")
      .select("rules")
      .eq("owner_email", ownerEmail)
      .eq("id", "default")
      .maybeSingle();
    if (row?.rules != null && isProductDefaultItemsRulesV1(row.rules)) return row.rules;
  } catch { /* gebruik default */ }
  return DEFAULT_PRODUCT_RULES_V1;
}

/** Herbereken defaultItems voor een fiets-item vanuit actuele rules. */
function liveDefaultItems(
  item: LineItemFromJson,
  rules: ProductDefaultItemsRulesV1
): string[] {
  if (!item.isFiets) return [];
  return applyProductDefaultItemsRules(item.name, item.properties ?? [], rules);
}

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data: allOrders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail);
    if (error) {
      console.error("[api/paklijst]", error);
      return NextResponse.json({ error: "Genereren mislukt." }, { status: 500 });
    }

    const productRules = await loadProductRules(ownerEmail);

    const orders = (allOrders ?? []).filter((o) => {
      if (o.status !== "ritjes_vandaag") return false;
      if (!o.meenemen_in_planning) return false;
      if (!isDatumOpmerkingVandaagOfMorgen(o.datum_opmerking)) return false;
      return true;
    });

    // ── Per-order detail blokken ──────────────────────────────────────────
    const ordersDetail: OrderDetail[] = orders.map((order) => {
      let products: LineItemFromJson[] = [];
      try {
        if (order.line_items_json) {
          products = JSON.parse(order.line_items_json as string) as LineItemFromJson[];
        }
      } catch { /* ignore */ }
      if (products.length === 0) {
        products = parseProductsTextFallback(order.producten);
      }

      return {
        id: String(order.id),
        order_nummer: order.order_nummer as string | number | null ?? null,
        naam: order.naam as string | null ?? null,
        volledig_adres: order.volledig_adres as string | null ?? null,
        aankomsttijd_slot: order.aankomsttijd_slot as string | null ?? null,
        telefoon_nummer: order.telefoon_nummer as string | null ?? null,
        bestelling_totaal_prijs: typeof order.bestelling_totaal_prijs === "number"
          ? order.bestelling_totaal_prijs
          : null,
        betaald: typeof order.betaald === "boolean" ? order.betaald : null,
        products,
      };
    });

    // Sorteer op aankomsttijd_slot (vroegst eerst)
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
        try { items = JSON.parse(raw) as LineItemFromJson[]; } catch { /* ignore */ }
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
