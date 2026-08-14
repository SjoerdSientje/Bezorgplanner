import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deductInventoryForMoneybirdInvoice } from "@/lib/inventory";
import {
  fetchSalesInvoiceById,
  verifyMoneybirdWebhookSignature,
  type MoneybirdSalesInvoice,
} from "@/lib/moneybird";

export const dynamic = "force-dynamic";

type MoneybirdWebhookPayload = {
  action?: string;
  entity_type?: string;
  entity_id?: string;
  state?: string;
  entity?: MoneybirdSalesInvoice | null;
};

/** Events waarbij we voorraad mogen aftrekken (verzonden / open, niet concept). */
const DEDUCT_ACTIONS = new Set([
  "sales_invoice_state_changed_to_open",
  "sales_invoice_state_changed_to_scheduled",
  "sales_invoice_state_changed_to_pending_payment",
  "sales_invoice_state_changed_to_late",
  "sales_invoice_state_changed_to_reminded",
  "sales_invoice_state_changed_to_paid",
  "sales_invoice_send_email",
  "sales_invoice_send_manually",
  "sales_invoice_send_post",
  "sales_invoice_send_si",
]);

function isNonDraftState(state: string | null | undefined): boolean {
  const s = String(state ?? "").trim().toLowerCase();
  return Boolean(s) && s !== "draft";
}

function shouldDeductForAction(
  action: string,
  invoice: MoneybirdSalesInvoice | null | undefined,
  payloadState?: string
): boolean {
  if (DEDUCT_ACTIONS.has(action)) return true;
  // Aanmaken + meteen versturen: soms alleen sales_invoice_created met state al open.
  if (action === "sales_invoice_created") {
    return isNonDraftState(invoice?.state) || isNonDraftState(payloadState);
  }
  return false;
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const signature = request.headers.get("Moneybird-Signature");

    if (!verifyMoneybirdWebhookSignature(raw, signature)) {
      // Moneybird POSTet bij webhook-aanmaak een test en eist HTTP 200 (zoals Make).
      // Payload niet verwerken; 401 blokkeert registratie.
      console.warn("[webhooks/moneybird] signature ontbreekt/ongeldig — skip");
      return NextResponse.json({ ok: true, skipped: "invalid_signature" }, { status: 200 });
    }

    let payload: MoneybirdWebhookPayload;
    try {
      payload = JSON.parse(raw || "{}") as MoneybirdWebhookPayload;
    } catch {
      return NextResponse.json({ ok: true, skipped: "invalid_json" }, { status: 200 });
    }

    const action = String(payload.action ?? "").trim();
    const entityType = String(payload.entity_type ?? "").trim();

    // Altijd 200 voor onbekende events (Moneybird stopt anders met retries).
    if (entityType && entityType !== "SalesInvoice") {
      return NextResponse.json({ ok: true, skipped: "entity_type" });
    }

    let invoice = payload.entity ?? null;
    const entityId = String(payload.entity_id ?? invoice?.id ?? "").trim();

    if (!invoice?.id && !entityId) {
      return NextResponse.json({ ok: true, skipped: "no_entity" });
    }

    if (!shouldDeductForAction(action, invoice, payload.state)) {
      return NextResponse.json({
        ok: true,
        skipped: "action_not_deduct",
        action: action || null,
        state: invoice?.state ?? payload.state ?? null,
      });
    }

    // Webhook-entity mist soms details → full invoice uit API.
    if (!invoice?.details?.length && entityId) {
      try {
        const full = await fetchSalesInvoiceById(entityId);
        if (full) invoice = full;
      } catch (fetchErr) {
        console.error("[webhooks/moneybird] fetch invoice:", fetchErr);
      }
    }

    if (!invoice?.id) {
      return NextResponse.json({ ok: true, skipped: "no_entity_after_fetch" });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      console.error("[webhooks/moneybird] Supabase niet geconfigureerd");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const result = await deductInventoryForMoneybirdInvoice(supabase, invoice);

    return NextResponse.json({
      ok: true,
      deducted: result.deducted,
      skippedReason: result.skippedReason ?? null,
      invoiceId: String(invoice.id),
      action: action || null,
    });
  } catch (e) {
    console.error("[webhooks/moneybird]", e);
    // 200 zodat Moneybird niet eindeloos retriet op programmeerfouten.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 200 }
    );
  }
}
