/**
 * Afgehandelde Shopify-pakketjes (< €450 / garantie-nalevering) archiveren in `orders`
 * zodat ze in klant-ordergeschiedenis verschijnen.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { allAccountEmails, shopifyWebhookOrderAppliesToOwner } from "@/lib/account";
import { isOrderMarkedCompleted } from "@/lib/order-completion";
import {
  attachMoneybirdFactuurForOrder,
  FACTUUR_BACKFILL_SINCE_ISO,
} from "@/lib/order-factuur";
import { findShopifyMainInvoice, isMoneybirdConfigured } from "@/lib/moneybird";
import { loadProductDefaultItemsRules } from "@/lib/product-rules-server";
import { shopifyAdminFetch } from "@/lib/shopify-admin";
import {
  isPakketjesTypeOrder,
  isShopifyOrderHandled,
  mapShopifyOrderToRitjesRow,
  shopifyOrderCreatedAt,
  shopifyOrderHandledAt,
  type ShopifyOrder,
} from "@/lib/shopify-order";

export type ArchivePakketjesResult = {
  id: string;
  created: boolean;
  moneybirdInvoiceId: string | null;
};

function nextOrdersPagePath(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
  if (!m?.[1]) return null;
  try {
    const u = new URL(m[1]);
    const apiMatch = u.pathname.match(/\/admin\/api\/[^/]+(\/.*)$/);
    if (apiMatch?.[1]) return `${apiMatch[1]}${u.search}`;
  } catch {
    /* ignore */
  }
  return null;
}

/** Shopify-orders sinds datum (any status), voor pakketjes-geschiedenis backfill. */
export async function fetchShopifyOrdersSince(opts?: {
  createdAtMinIso?: string | null;
  maxPages?: number;
}): Promise<ShopifyOrder[]> {
  const maxPages = Math.max(1, opts?.maxPages ?? 40);
  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    order: "created_at asc",
  });
  if (opts?.createdAtMinIso) {
    params.set("created_at_min", opts.createdAtMinIso);
  }

  const out: ShopifyOrder[] = [];
  let path: string | null = `/orders.json?${params.toString()}`;
  let pages = 0;

  while (path && pages < maxPages) {
    pages += 1;
    const res = await shopifyAdminFetch(path);
    const body = (await res.json()) as { orders?: ShopifyOrder[] };
    const batch = body.orders ?? [];
    out.push(...batch);
    path = nextOrdersPagePath(res.headers.get("link"));
    if (batch.length === 0) break;
  }

  return out;
}

/**
 * Upsert afgehandelde pakketjes-order als `status=bezorgd` in `orders`.
 * `afgerond_at` = Shopify afhandeltijd. MB-factuur koppelen indien gevonden.
 */
export async function upsertCompletedShopifyPakketOrder(
  supabase: SupabaseClient,
  ownerEmail: string,
  order: ShopifyOrder,
  options?: { attachFactuur?: boolean }
): Promise<ArchivePakketjesResult | null> {
  if (!isPakketjesTypeOrder(order) || !isShopifyOrderHandled(order)) {
    return null;
  }

  const productRules = await loadProductDefaultItemsRules(supabase, ownerEmail);
  const mapped = mapShopifyOrderToRitjesRow(order, productRules);
  const shopifyOrderId = String(mapped.order_id ?? "").trim();
  if (!shopifyOrderId) return null;

  const handledAt = shopifyOrderHandledAt(order).toISOString();
  const createdAt = shopifyOrderCreatedAt(order).toISOString();

  let moneybirdInvoiceId: string | null = null;
  if (isMoneybirdConfigured()) {
    try {
      // Eerst lokale lock (geen MB API) — voorkomt 429 bij backfill.
      const { data: lockRow } = await supabase
        .from("moneybird_shopify_invoice_locks")
        .select("moneybird_invoice_id")
        .eq("shopify_order_id", shopifyOrderId)
        .maybeSingle();
      moneybirdInvoiceId =
        String(lockRow?.moneybird_invoice_id ?? "").trim() || null;

      if (!moneybirdInvoiceId) {
        const invoice = await findShopifyMainInvoice(shopifyOrderId, supabase);
        moneybirdInvoiceId = String(invoice?.id ?? "").trim() || null;
      }
    } catch (err) {
      console.warn(
        "[pakketjes-order-history] MB factuur zoeken mislukt:",
        shopifyOrderId,
        err instanceof Error ? err.message : err
      );
    }
  }

  const { data: existing } = await supabase
    .from("orders")
    .select(
      "id, status, afgerond_at, moneybird_invoice_id, link_factuur, meenemen_in_planning, nieuw_appje_sturen, bezorger_naam"
    )
    .eq("owner_email", ownerEmail)
    .eq("order_id", shopifyOrderId)
    .eq("source", "shopify")
    .maybeSingle();

  if (existing?.id) {
    const alreadyDone = isOrderMarkedCompleted(existing);
    const patch: Record<string, unknown> = {
      order_nummer: mapped.order_nummer,
      naam: mapped.naam,
      email: mapped.email,
      producten: mapped.producten,
      bestelling_totaal_prijs: mapped.bestelling_totaal_prijs,
      betaald: mapped.betaald,
      al_betaald: mapped.al_betaald,
      te_betalen: mapped.te_betalen,
      volledig_adres: mapped.volledig_adres,
      telefoon_nummer: mapped.telefoon_nummer,
      telefoon_e164: mapped.telefoon_e164,
      line_items_json: mapped.line_items_json,
      type: mapped.type,
      mp_tags: mapped.mp_tags,
      meenemen_in_planning: false,
      nieuw_appje_sturen: false,
    };

    if (!alreadyDone) {
      patch.status = "bezorgd";
      patch.afgerond_at = handledAt;
    } else if (!existing.afgerond_at) {
      patch.afgerond_at = handledAt;
    }

    if (!String(existing.bezorger_naam ?? "").trim()) {
      patch.bezorger_naam = "Pakket";
    }

    if (moneybirdInvoiceId && !String(existing.moneybird_invoice_id ?? "").trim()) {
      patch.moneybird_invoice_id = moneybirdInvoiceId;
    }

    const { error } = await supabase.from("orders").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);

    if (options?.attachFactuur !== false) {
      try {
        await attachMoneybirdFactuurForOrder(supabase, {
          id: existing.id,
          owner_email: ownerEmail,
          source: "shopify",
          type: mapped.type,
          status: "bezorgd",
          order_id: shopifyOrderId,
          order_nummer: mapped.order_nummer,
          email: mapped.email,
          moneybird_invoice_id:
            moneybirdInvoiceId || String(existing.moneybird_invoice_id ?? "").trim() || null,
          link_factuur: existing.link_factuur ?? null,
          afgerond_at: String(existing.afgerond_at ?? handledAt),
          mp_tags: mapped.mp_tags,
        });
      } catch (err) {
        console.warn(
          "[pakketjes-order-history] factuur attach mislukt:",
          existing.id,
          err instanceof Error ? err.message : err
        );
      }
    }

    return {
      id: existing.id,
      created: false,
      moneybirdInvoiceId:
        moneybirdInvoiceId || String(existing.moneybird_invoice_id ?? "").trim() || null,
    };
  }

  const insertRow = {
    owner_email: ownerEmail,
    source: "shopify" as const,
    type: mapped.type,
    status: "bezorgd" as const,
    order_nummer: mapped.order_nummer,
    naam: mapped.naam,
    adres_url: mapped.adres_url,
    bel_link: mapped.bel_link,
    bezorgtijd_voorkeur: mapped.bezorgtijd_voorkeur,
    meenemen_in_planning: false,
    nieuw_appje_sturen: false,
    datum_opmerking: mapped.datum_opmerking,
    opmerkingen_klant: mapped.opmerkingen_klant,
    producten: mapped.producten,
    bestelling_totaal_prijs: mapped.bestelling_totaal_prijs,
    betaald: mapped.betaald,
    al_betaald: mapped.al_betaald,
    te_betalen: mapped.te_betalen,
    volledig_adres: mapped.volledig_adres,
    telefoon_nummer: mapped.telefoon_nummer,
    order_id: shopifyOrderId,
    datum: mapped.datum,
    aantal_fietsen: mapped.aantal_fietsen,
    email: mapped.email,
    telefoon_e164: mapped.telefoon_e164,
    model: mapped.model,
    serienummer: mapped.serienummer,
    mp_tags: mapped.mp_tags,
    line_items_json: mapped.line_items_json,
    afgerond_at: handledAt,
    bezorger_naam: "Pakket",
    moneybird_invoice_id: moneybirdInvoiceId,
    created_at: createdAt,
  };

  const { data: inserted, error } = await supabase
    .from("orders")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    // Race: parallel webhook → unique conflict → opnieuw als update.
    if (/duplicate|unique/i.test(error.message)) {
      return upsertCompletedShopifyPakketOrder(supabase, ownerEmail, order, options);
    }
    throw new Error(error.message);
  }

  const id = String(inserted?.id ?? "");
  if (!id) return null;

  if (options?.attachFactuur !== false) {
    try {
      await attachMoneybirdFactuurForOrder(supabase, {
        id,
        owner_email: ownerEmail,
        source: "shopify",
        type: mapped.type,
        status: "bezorgd",
        order_id: shopifyOrderId,
        order_nummer: mapped.order_nummer,
        email: mapped.email,
        moneybird_invoice_id: moneybirdInvoiceId,
        link_factuur: null,
        afgerond_at: handledAt,
        mp_tags: mapped.mp_tags,
      });
    } catch (err) {
      console.warn(
        "[pakketjes-order-history] factuur attach mislukt:",
        id,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { id, created: true, moneybirdInvoiceId };
}

/** Archiveer afgehandelde pakketjes-order voor alle relevante accounts. */
export async function archiveFulfilledPakketjesForOwners(
  supabase: SupabaseClient,
  order: ShopifyOrder
): Promise<number> {
  if (!isPakketjesTypeOrder(order) || !isShopifyOrderHandled(order)) return 0;
  let n = 0;
  for (const ownerEmail of allAccountEmails()) {
    if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;
    const result = await upsertCompletedShopifyPakketOrder(supabase, ownerEmail, order, {
      attachFactuur: true,
    });
    if (result) n += 1;
  }
  return n;
}

export type PakketjesHistoryBackfillStats = {
  scanned: number;
  eligible: number;
  created: number;
  updated: number;
  withInvoice: number;
  skipped: number;
  errors: number;
};

/**
 * Backfill: Shopify-pakketjes sinds Moneybird-start (1 okt 2026) → `orders` + MB-factuur.
 */
export async function backfillPakketjesOrderHistory(
  supabase: SupabaseClient,
  options?: {
    createdAtMinIso?: string;
    ownerEmail?: string;
    dryRun?: boolean;
    maxPages?: number;
    attachFactuur?: boolean;
  }
): Promise<PakketjesHistoryBackfillStats> {
  const createdAtMinIso = options?.createdAtMinIso ?? FACTUUR_BACKFILL_SINCE_ISO;
  const dryRun = Boolean(options?.dryRun);
  const owners = options?.ownerEmail
    ? [options.ownerEmail]
    : allAccountEmails();

  const orders = await fetchShopifyOrdersSince({
    createdAtMinIso,
    maxPages: options?.maxPages ?? 40,
  });

  const stats: PakketjesHistoryBackfillStats = {
    scanned: orders.length,
    eligible: 0,
    created: 0,
    updated: 0,
    withInvoice: 0,
    skipped: 0,
    errors: 0,
  };

  for (const order of orders) {
    if (!isPakketjesTypeOrder(order) || !isShopifyOrderHandled(order)) {
      stats.skipped += 1;
      continue;
    }
    stats.eligible += 1;

    for (const ownerEmail of owners) {
      if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) continue;

      if (dryRun) {
        stats.created += 1;
        continue;
      }

      try {
        const result = await upsertCompletedShopifyPakketOrder(
          supabase,
          ownerEmail,
          order,
          { attachFactuur: options?.attachFactuur !== false }
        );
        if (!result) {
          stats.skipped += 1;
          continue;
        }
        if (result.created) stats.created += 1;
        else stats.updated += 1;
        if (result.moneybirdInvoiceId) stats.withInvoice += 1;
        // Rate-limit Moneybird (429 bij snelle batches).
        await new Promise((r) => setTimeout(r, 450));
      } catch (err) {
        stats.errors += 1;
        console.error(
          "[pakketjes-order-history] backfill fout",
          order.id,
          order.name,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return stats;
}
