import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deductInventoryForMoneybirdInvoice } from "@/lib/inventory";
import {
  verifyMoneybirdWebhookSignature,
  type MoneybirdSalesInvoice,
} from "@/lib/moneybird";

export const dynamic = "force-dynamic";

type MoneybirdWebhookPayload = {
  action?: string;
  entity_type?: string;
  entity_id?: string;
  entity?: MoneybirdSalesInvoice | null;
};

const HANDLED_ACTIONS = new Set([
  "sales_invoice_created",
  "sales_invoice_state_changed_to_open",
  "sales_invoice_state_changed_to_scheduled",
  "sales_invoice_state_changed_to_pending_payment",
  "sales_invoice_state_changed_to_late",
  "sales_invoice_state_changed_to_reminded",
  "sales_invoice_state_changed_to_paid",
]);

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const signature = request.headers.get("Moneybird-Signature");

    if (!verifyMoneybirdWebhookSignature(raw, signature)) {
      console.error("[webhooks/moneybird] invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(raw) as MoneybirdWebhookPayload;
    const action = String(payload.action ?? "").trim();
    const entityType = String(payload.entity_type ?? "").trim();

    // Altijd 200 teruggeven voor onbekende events (Moneybird stopt anders met retries).
    if (entityType && entityType !== "SalesInvoice") {
      return NextResponse.json({ ok: true, skipped: "entity_type" });
    }
    if (action && !HANDLED_ACTIONS.has(action) && !action.startsWith("sales_invoice_")) {
      return NextResponse.json({ ok: true, skipped: "action" });
    }

    // Alleen bij create aftrekken — state-changes hergebruiken dezelfde mark (idempotent).
    // sales_invoice_created is de primaire trigger; andere sales_invoice_* events
    // mogen binnenkomen maar doen niets nieuws als de mark al staat.
    const invoice = payload.entity;
    if (!invoice?.id) {
      return NextResponse.json({ ok: true, skipped: "no_entity" });
    }

    // Alleen aftrekken bij create (of open als create-event gemist werd).
    const shouldAttemptDeduct =
      action === "sales_invoice_created" ||
      action === "sales_invoice_state_changed_to_open" ||
      !action;

    if (!shouldAttemptDeduct) {
      return NextResponse.json({ ok: true, skipped: "action_not_deduct" });
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
    });
  } catch (e) {
    console.error("[webhooks/moneybird]", e);
    // 200 zodat Moneybird niet eindeloos retriet op programmeerfouten;
    // log wel voor debugging.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 200 }
    );
  }
}
