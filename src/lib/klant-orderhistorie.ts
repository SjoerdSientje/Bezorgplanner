import { COMPLETED_ORDER_STATUSES } from "@/lib/order-completion";
import {
  formatKlantOrderDateTime,
  klantOrderTypeLabel,
  type KlantOrderHistorieDetail,
  type KlantOrderHistorieProduct,
} from "@/lib/klant-orderhistorie-shared";
import { createServerSupabaseClient } from "@/lib/supabase";

export type {
  KlantOrderHistorieDetail,
  KlantOrderHistorieProduct,
  KlantOrderHistorieSamenvatting,
} from "@/lib/klant-orderhistorie-shared";

type OrderRow = {
  id: string;
  source: string | null;
  type: string | null;
  status: string | null;
  order_nummer: string | null;
  email: string | null;
  producten: string | null;
  line_items_json: string | null;
  bestelling_totaal_prijs: number | null;
  opmerkingen_klant: string | null;
  link_factuur: string | null;
  link_aankoopbewijs: string | null;
  created_at: string | null;
  afgerond_at: string | null;
};

const ORDER_SELECT =
  "id, source, type, status, order_nummer, email, producten, line_items_json, bestelling_totaal_prijs, opmerkingen_klant, link_factuur, link_aankoopbewijs, created_at, afgerond_at";

function parseProducten(
  producten: string | null | undefined,
  lineItemsJson: string | null | undefined
): KlantOrderHistorieProduct[] {
  if (lineItemsJson) {
    try {
      const items = JSON.parse(lineItemsJson) as Array<{
        name?: string | null;
        price?: number | string | null;
      }>;
      if (Array.isArray(items) && items.length > 0) {
        return items
          .map((item) => {
            const naam = String(item?.name ?? "").trim();
            if (!naam) return null;
            const raw = item?.price;
            const prijs =
              typeof raw === "number"
                ? raw
                : typeof raw === "string"
                  ? parseFloat(raw.replace(",", "."))
                  : NaN;
            return {
              naam,
              prijs: Number.isFinite(prijs) ? prijs : null,
            } satisfies KlantOrderHistorieProduct;
          })
          .filter((p): p is KlantOrderHistorieProduct => p != null);
      }
    } catch {
      /* fall through */
    }
  }

  const text = String(producten ?? "").trim();
  if (!text) return [];
  return text
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((naam) => ({ naam, prijs: null }));
}

function toDetail(row: OrderRow): KlantOrderHistorieDetail {
  const totaal = row.bestelling_totaal_prijs;
  return {
    id: String(row.id),
    aangemaaktOp: formatKlantOrderDateTime(row.created_at),
    typeLabel: klantOrderTypeLabel({ source: row.source, type: row.type }),
    totaalPrijs:
      totaal != null && Number.isFinite(Number(totaal)) ? Number(totaal) : null,
    orderNummer: String(row.order_nummer ?? "").trim() || null,
    opmerking: String(row.opmerkingen_klant ?? "").trim() || null,
    afgerondOp: formatKlantOrderDateTime(row.afgerond_at),
    producten: parseProducten(row.producten, row.line_items_json),
    linkFactuur: String(row.link_factuur ?? "").trim() || null,
    linkAankoopbewijs: String(row.link_aankoopbewijs ?? "").trim() || null,
  };
}

/**
 * Alle afgeronde orders van een klant (op e-mail), terugwerkend uit `orders`.
 * Ontbrekende velden blijven null — order wordt toch meegenomen.
 */
export async function listKlantOrderHistorie(
  ownerEmail: string,
  customerEmail: string
): Promise<KlantOrderHistorieDetail[]> {
  const email = String(customerEmail ?? "").trim().toLowerCase();
  if (!email) return [];

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("owner_email", ownerEmail)
    .ilike("email", email)
    .in("status", [...COMPLETED_ORDER_STATUSES])
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error || !Array.isArray(data)) {
    if (error) {
      console.error("[klant-orderhistorie]", error.message);
    }
    return [];
  }

  // Extra guard: ilike zonder % is case-insensitive equality, maar filter strikt.
  return (data as OrderRow[])
    .filter(
      (row) => String(row.email ?? "").trim().toLowerCase() === email
    )
    .map(toDetail);
}

export async function getKlantOrderHistorieItem(
  ownerEmail: string,
  customerEmail: string,
  orderId: string
): Promise<KlantOrderHistorieDetail | null> {
  const email = String(customerEmail ?? "").trim().toLowerCase();
  const id = String(orderId ?? "").trim();
  if (!email || !id) return null;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("owner_email", ownerEmail)
    .eq("id", id)
    .ilike("email", email)
    .in("status", [...COMPLETED_ORDER_STATUSES])
    .maybeSingle();

  if (error || !data) return null;
  const row = data as OrderRow;
  if (String(row.email ?? "").trim().toLowerCase() !== email) return null;
  return toDetail(row);
}
