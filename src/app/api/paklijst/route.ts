import { NextResponse } from "next/server";
import { fetchAllOrders } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface LineItemFromJson {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
  defaultItems?: string[];
}

function shouldIgnorePaklijstItemName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  // Levering/montage labels horen niet in paklijst
  if (n === "volledig rijklaar") return true;
  if (n === "rijklaar") return true;
  if (n === "in doos") return true;
  return false;
}

/** Vandaag in DD-MM-YYYY formaat */
function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * True als datum_opmerking overeenkomt met vandaag.
 * Matcht op: "vandaag", DD-MM-YYYY van vandaag.
 */
function isDatumVandaag(datum: unknown): boolean {
  if (!datum) return false;
  const d = String(datum).toLowerCase().trim();
  if (d === "vandaag") return true;
  return d === todayDDMMYYYY();
}

export async function GET() {
  try {
    const allOrders = await fetchAllOrders();

    // Filter: ritjes vandaag + meenemen in planning + datum vandaag
    const orders = allOrders.filter((o) => {
      if (o.status !== "ritjes_vandaag") return false;
      if (!o.meenemen_in_planning) return false;
      if (!isDatumVandaag(o.datum_opmerking)) return false;
      return true;
    });

    // Tel alle accessoire-producten op
    const counts: Record<string, number> = {};

    const add = (naam: string) => {
      const n = naam.trim();
      if (!n) return;
      if (shouldIgnorePaklijstItemName(n)) return;
      counts[n] = (counts[n] ?? 0) + 1;
    };

    for (const order of orders) {
      const raw = order.line_items_json as string | null | undefined;
      if (!raw) continue;

      let items: LineItemFromJson[] = [];
      try {
        items = JSON.parse(raw) as LineItemFromJson[];
      } catch {
        continue;
      }

      for (const item of items) {
        if (!item.isFiets) {
          // Gewone accessoire in de bestelling (prijs < €500)
          add(item.name);
        } else {
          // Fiets: voeg standaard inbegrepen producten toe
          for (const d of item.defaultItems ?? []) {
            add(d);
          }
        }
      }
    }

    // Sorteer: hoogste count eerst, dan alfabetisch
    const items = Object.entries(counts)
      .sort(([nameA, cntA], [nameB, cntB]) => cntB - cntA || nameA.localeCompare(nameB, "nl"))
      .map(([name, count]) => ({ name, count }));

    return NextResponse.json(
      {
        items,
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
