/**
 * Moneybird-factuur PDF ophalen, opslaan in Storage, en koppelen aan orders.link_factuur.
 * Voor bezorgde (niet-MP) orders: afronden + backfill vanaf 1 okt 2026.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  downloadSalesInvoicePdf,
  fetchSalesInvoiceById,
  findShopifyMainInvoice,
  isMoneybirdConfigured,
  sendSalesInvoiceByEmail,
  type MoneybirdSalesInvoice,
} from "@/lib/moneybird";

const BUCKET = "facturen";
/** Moneybird in gebruik sinds 1 oktober 2026. */
export const FACTUUR_BACKFILL_SINCE_ISO = "2026-10-01T00:00:00.000Z";

export type OrderForFactuur = {
  id: string;
  owner_email?: string | null;
  source?: string | null;
  type?: string | null;
  status?: string | null;
  order_id?: string | null;
  order_nummer?: string | null;
  email?: string | null;
  moneybird_invoice_id?: string | null;
  link_factuur?: string | null;
  afgerond_at?: string | null;
  mp_tags?: string | null;
};

function isMpLikeOrder(order: OrderForFactuur): boolean {
  const source = String(order.source ?? "").trim().toLowerCase();
  if (source === "mp") return true;
  if (/^#?mp/i.test(String(order.order_nummer ?? "").trim())) return true;
  return /\bmp\b/.test(String(order.mp_tags ?? "").toLowerCase());
}

async function resolveMoneybirdInvoiceForOrder(
  supabase: SupabaseClient,
  order: OrderForFactuur
): Promise<MoneybirdSalesInvoice | null> {
  const existingId = String(order.moneybird_invoice_id ?? "").trim();
  if (existingId) {
    const byId = await fetchSalesInvoiceById(existingId);
    if (byId?.id) return byId;
  }

  const shopifyOrderId = String(order.order_id ?? "").trim();
  const source = String(order.source ?? "").trim().toLowerCase();
  if (source === "shopify" && shopifyOrderId) {
    return findShopifyMainInvoice(shopifyOrderId, supabase);
  }

  return null;
}

async function uploadFactuurPdf(
  supabase: SupabaseClient,
  orderId: string,
  orderNummer: string | null | undefined,
  pdf: Buffer
): Promise<string> {
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {});

  const safeNum = String(orderNummer ?? orderId)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 60);
  const path = `${orderId}/factuur-${safeNum}-${Date.now()}.pdf`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) {
    throw new Error(`Factuur-PDF upload mislukt: ${error.message}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Zoek Moneybird-hoofdfactuur voor deze order, download PDF, sla op, zet link_factuur.
 * Geen factuur / MP-order → null (geen fout).
 */
export async function attachMoneybirdFactuurForOrder(
  supabase: SupabaseClient,
  order: OrderForFactuur,
  options?: { force?: boolean }
): Promise<{
  link: string | null;
  invoiceId: string | null;
  skipped?: string;
}> {
  if (!isMoneybirdConfigured()) {
    return { link: null, invoiceId: null, skipped: "not_configured" };
  }
  if (isMpLikeOrder(order)) {
    return { link: null, invoiceId: null, skipped: "mp_order" };
  }

  const existingLink = String(order.link_factuur ?? "").trim();
  if (existingLink && !options?.force) {
    return {
      link: existingLink,
      invoiceId: String(order.moneybird_invoice_id ?? "").trim() || null,
      skipped: "already_attached",
    };
  }

  const invoice = await resolveMoneybirdInvoiceForOrder(supabase, order);
  const invoiceId = String(invoice?.id ?? "").trim();
  if (!invoiceId) {
    return { link: null, invoiceId: null, skipped: "no_invoice" };
  }

  const pdf = await downloadSalesInvoicePdf(invoiceId);
  const link = await uploadFactuurPdf(
    supabase,
    String(order.id),
    order.order_nummer,
    pdf
  );

  const patch: Record<string, unknown> = { link_factuur: link };
  if (!String(order.moneybird_invoice_id ?? "").trim()) {
    patch.moneybird_invoice_id = invoiceId;
  }

  const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
  if (error) {
    if (/link_factuur/i.test(error.message)) {
      throw new Error(
        "Kolom link_factuur ontbreekt — draai migratie 045_orders_link_factuur.sql in Supabase."
      );
    }
    throw new Error(`link_factuur opslaan mislukt: ${error.message}`);
  }

  return { link, invoiceId };
}

/** Verstuur Moneybird-factuur opnieuw per e-mail (via Moneybird API). */
export async function sendOrderFactuurByEmail(
  supabase: SupabaseClient,
  order: OrderForFactuur,
  emailAddress: string
): Promise<{ ok: true; invoiceId: string }> {
  const email = String(emailAddress ?? "").trim();
  if (!email.includes("@")) {
    throw new Error("Ongeldig e-mailadres.");
  }

  let invoiceId = String(order.moneybird_invoice_id ?? "").trim();
  if (!invoiceId) {
    const invoice = await resolveMoneybirdInvoiceForOrder(supabase, order);
    invoiceId = String(invoice?.id ?? "").trim();
  }
  if (!invoiceId) {
    throw new Error("Geen Moneybird-factuur gevonden voor deze order.");
  }

  await sendSalesInvoiceByEmail(invoiceId, { emailAddress: email });

  // Zorg dat er ook een downloadbare PDF-link op de order staat.
  if (!String(order.link_factuur ?? "").trim()) {
    try {
      await attachMoneybirdFactuurForOrder(supabase, {
        ...order,
        moneybird_invoice_id: invoiceId,
      });
    } catch (err) {
      console.warn(
        "[order-factuur] PDF attach na verzenden mislukt:",
        err instanceof Error ? err.message : err
      );
    }
  } else if (!String(order.moneybird_invoice_id ?? "").trim()) {
    await supabase
      .from("orders")
      .update({ moneybird_invoice_id: invoiceId })
      .eq("id", order.id);
  }

  return { ok: true, invoiceId };
}

/**
 * Backfill link_factuur voor bezorgde niet-MP orders sinds FACTUUR_BACKFILL_SINCE_ISO.
 * Beperkt aantal per run (pagina-load / cron).
 */
export async function backfillBezorgdeOrderFacturen(
  supabase: SupabaseClient,
  ownerEmail: string,
  options?: { limit?: number }
): Promise<{ attempted: number; attached: number; skipped: number; errors: number }> {
  const limit = Math.max(1, Math.min(40, options?.limit ?? 12));
  if (!isMoneybirdConfigured()) {
    return { attempted: 0, attached: 0, skipped: 0, errors: 0 };
  }

  const { data: rows, error } = await supabase
    .from("orders")
    .select(
      "id, owner_email, source, type, status, order_id, order_nummer, email, moneybird_invoice_id, link_factuur, afgerond_at, mp_tags"
    )
    .eq("owner_email", ownerEmail)
    .eq("status", "bezorgd")
    .in("source", ["shopify", "reparatie"])
    .gte("afgerond_at", FACTUUR_BACKFILL_SINCE_ISO)
    .is("link_factuur", null)
    .order("afgerond_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    if (/link_factuur/i.test(error.message)) {
      console.warn(
        "[order-factuur] backfill overgeslagen — migratie 045 nog niet gedraaid:",
        error.message
      );
      return { attempted: 0, attached: 0, skipped: 0, errors: 0 };
    }
    throw new Error(error.message);
  }

  let attached = 0;
  let skipped = 0;
  let errors = 0;
  const list = (rows ?? []) as OrderForFactuur[];

  for (const order of list) {
    if (isMpLikeOrder(order)) {
      skipped += 1;
      continue;
    }
    try {
      const result = await attachMoneybirdFactuurForOrder(supabase, order);
      if (result.link && !result.skipped) attached += 1;
      else skipped += 1;
    } catch (err) {
      errors += 1;
      console.error(
        "[order-factuur] backfill mislukt voor",
        order.id,
        order.order_nummer,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { attempted: list.length, attached, skipped, errors };
}
