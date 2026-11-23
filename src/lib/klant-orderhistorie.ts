import {
  formatKlantOrderBezorger,
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
  opgehaald_at: string | null;
  opgehaald_door: string | null;
  gekoppeld_ophalen_order_id: string | null;
  ophalen_afgehandeld_via: string | null;
  moneybird_estimate_number: string | null;
  bezorger_naam: string | null;
  aangemaakt_door: string | null;
  achtergrondverhaal: string | null;
};

type LinkedOphalen = {
  created_at: string | null;
  opgehaald_at: string | null;
  opgehaald_door: string | null;
  aangemaakt_door: string | null;
};

const ORDER_SELECT =
  "id, source, type, status, order_nummer, email, producten, line_items_json, bestelling_totaal_prijs, opmerkingen_klant, link_factuur, link_aankoopbewijs, created_at, afgerond_at, opgehaald_at, opgehaald_door, gekoppeld_ophalen_order_id, ophalen_afgehandeld_via, moneybird_estimate_number, bezorger_naam, aangemaakt_door, achtergrondverhaal";

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

function toDetail(
  row: OrderRow,
  linkedOphalen?: LinkedOphalen | null
): KlantOrderHistorieDetail {
  const totaal = row.bestelling_totaal_prijs;
  const orderNummer = String(row.order_nummer ?? "").trim() || null;
  const type = String(row.type ?? "").trim();
  const via = String(row.ophalen_afgehandeld_via ?? "").trim().toLowerCase();
  const hasLinked = Boolean(linkedOphalen);
  const isWinkelafhaal =
    type === "reparatie_ophalen" && via === "winkelafhaal";
  const isTerugbrengFlow =
    type === "reparatie_terugbrengen" &&
    (hasLinked || Boolean(String(row.gekoppeld_ophalen_order_id ?? "").trim()));

  const ophaalCreated = linkedOphalen?.created_at ?? row.created_at;
  const ophaalDoor =
    String(linkedOphalen?.aangemaakt_door ?? row.aangemaakt_door ?? "").trim() ||
    null;
  const opgehaaldAt = linkedOphalen?.opgehaald_at ?? row.opgehaald_at;
  const opgehaaldDoor =
    String(linkedOphalen?.opgehaald_door ?? row.opgehaald_door ?? "").trim() ||
    null;

  return {
    id: String(row.id),
    source: String(row.source ?? "").trim().toLowerCase() || null,
    type: type || null,
    aangemaaktOp: formatKlantOrderDateTime(
      isTerugbrengFlow ? ophaalCreated : row.created_at
    ),
    typeLabel: klantOrderTypeLabel({
      source: row.source,
      type: row.type,
      ophalenAfgehandeldVia: row.ophalen_afgehandeld_via,
      gekoppeldOphalen: isTerugbrengFlow,
    }),
    totaalPrijs:
      totaal != null && Number.isFinite(Number(totaal)) ? Number(totaal) : null,
    orderNummer,
    opmerking: String(row.opmerkingen_klant ?? "").trim() || null,
    afgerondOp: formatKlantOrderDateTime(row.afgerond_at),
    opgehaaldOp: formatKlantOrderDateTime(opgehaaldAt),
    opgehaaldDoor,
    bezorger: formatKlantOrderBezorger({
      type: row.type,
      bezorgerNaam: row.bezorger_naam,
      orderNummer,
    }),
    aangemaaktDoor: isTerugbrengFlow
      ? ophaalDoor
      : String(row.aangemaakt_door ?? "").trim() || null,
    terugbrengAangemaaktOp: isTerugbrengFlow
      ? formatKlantOrderDateTime(row.created_at)
      : null,
    terugbrengAangemaaktDoor: isTerugbrengFlow
      ? String(row.aangemaakt_door ?? "").trim() || null
      : null,
    teruggebrachtOp: isTerugbrengFlow
      ? formatKlantOrderDateTime(row.afgerond_at)
      : null,
    teruggebrachtDoor: isTerugbrengFlow
      ? String(row.bezorger_naam ?? "").trim() || null
      : null,
    fietsAfgerondOp: isWinkelafhaal
      ? formatKlantOrderDateTime(row.afgerond_at)
      : null,
    ophalenAfgehandeldVia: via || null,
    achtergrondverhaal: String(row.achtergrondverhaal ?? "").trim() || null,
    producten: parseProducten(row.producten, row.line_items_json),
    linkFactuur: String(row.link_factuur ?? "").trim() || null,
    linkAankoopbewijs: String(row.link_aankoopbewijs ?? "").trim() || null,
    offerteNummer: String(row.moneybird_estimate_number ?? "").trim() || null,
  };
}

/**
 * Orders in klantgeschiedenis: alleen afgeronde orders (bezorgd / mp_orders).
 * Ophaal-wachtkamer (status opgehaald) komt hier niet in.
 */
const HISTORY_ORDER_FILTER = "status.eq.bezorgd,status.eq.mp_orders";

async function enrichWithLinkedOphalen(
  ownerEmail: string,
  rows: OrderRow[]
): Promise<KlantOrderHistorieDetail[]> {
  const supabase = createServerSupabaseClient();
  const linkIds = Array.from(
    new Set(
      rows
        .map((r) => String(r.gekoppeld_ophalen_order_id ?? "").trim())
        .filter(Boolean)
    )
  );
  const linked = new Map<string, LinkedOphalen>();
  if (linkIds.length > 0) {
    const { data } = await supabase
      .from("orders")
      .select("id, created_at, opgehaald_at, opgehaald_door, aangemaakt_door")
      .eq("owner_email", ownerEmail)
      .in("id", linkIds);
    for (const r of data ?? []) {
      linked.set(String(r.id), {
        created_at: r.created_at ?? null,
        opgehaald_at: r.opgehaald_at ?? null,
        opgehaald_door: r.opgehaald_door ?? null,
        aangemaakt_door: r.aangemaakt_door ?? null,
      });
    }
  }
  return rows.map((row) => {
    const lid = String(row.gekoppeld_ophalen_order_id ?? "").trim();
    return toDetail(row, lid ? linked.get(lid) ?? null : null);
  });
}

/**
 * Ordergeschiedenis van een klant (op e-mail), terugwerkend uit `orders`.
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
    .or(HISTORY_ORDER_FILTER)
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error || !Array.isArray(data)) {
    if (error) {
      console.error("[klant-orderhistorie]", error.message);
    }
    return [];
  }

  const rows = (data as OrderRow[]).filter(
    (row) => String(row.email ?? "").trim().toLowerCase() === email
  );
  return enrichWithLinkedOphalen(ownerEmail, rows);
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
    .or(HISTORY_ORDER_FILTER)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as OrderRow;
  if (String(row.email ?? "").trim().toLowerCase() !== email) return null;
  const [detail] = await enrichWithLinkedOphalen(ownerEmail, [row]);
  return detail ?? null;
}
