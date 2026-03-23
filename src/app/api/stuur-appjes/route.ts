import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/stuur-appjes
 * Body: { orders: Array<{ order_id: string; aankomsttijd_slot: string; telefoon_e164: string; naam: string }> }
 *
 * Stuurt WhatsApp berichten met het nieuwe tijdslot naar de geselecteerde klanten.
 * Template + verzendlogica volgt (Make.com webhook / WhatsApp Business API).
 * Voor nu: update planning_slots.aankomsttijd met het nieuwe slot en log de orders.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const selected = (body.orders ?? []) as Array<{
      order_id: string;
      slot_id: string;
      aankomsttijd_slot: string;
      telefoon_e164: string;
      naam: string;
      order_nummer: string;
    }>;
    const templateName = String(body.template_name ?? "").trim();
    const languageCode = String(body.language_code ?? "nl").trim() || "nl";
    const bodyVariables = Array.isArray(body.body_variables)
      ? body.body_variables.map((v: unknown) => String(v ?? ""))
      : [];
    const headerVariables = Array.isArray(body.header_variables)
      ? body.header_variables.map((v: unknown) => String(v ?? ""))
      : [];
    const fillTemplateVar = (
      input: string,
      order: { naam: string; order_nummer: string; aankomsttijd_slot: string }
    ) =>
      input
        .replaceAll("{naam}", order.naam ?? "")
        .replaceAll("{order_nummer}", order.order_nummer ?? "")
        .replaceAll("{tijdslot}", order.aankomsttijd_slot ?? "");

    if (selected.length === 0) {
      return NextResponse.json(
        { error: "Geen orders geselecteerd." },
        { status: 400 }
      );
    }
    if (!templateName) {
      return NextResponse.json(
        { error: "template_name is verplicht." },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Sync handmatig aangepaste tijdslot terug naar planning_slots.
    // We updaten op `order_id` (en niet alleen `slot_id`) zodat het altijd klopt
    // als iemand een order in planning heeft die niet exact via deze slot-id matcht.
    for (const o of selected) {
      if (!o.aankomsttijd_slot) continue;

      // 1) Primary: update via slot_id (als aanwezig)
      if (o.slot_id) {
        await supabase
          .from("planning_slots")
          .update({ aankomsttijd: o.aankomsttijd_slot })
          .eq("id", o.slot_id);
      }

      // 2) Fallback/extra: update via order_id (covers date/slot mismatches)
      await supabase
        .from("planning_slots")
        .update({ aankomsttijd: o.aankomsttijd_slot })
        .eq("order_id", o.order_id);
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !waToken) {
      return NextResponse.json(
        {
          error:
            "WhatsApp niet geconfigureerd. Zet WHATSAPP_PHONE_NUMBER_ID en WHATSAPP_ACCESS_TOKEN in je environment.",
        },
        { status: 500 }
      );
    }

    const toDigits = (raw: string) =>
      String(raw ?? "")
        .replace(/[^\d+]/g, "")
        .replace(/^\+/, "");

    const details: string[] = [];
    let sentCount = 0;
    let failCount = 0;

    for (const o of selected) {
      const to = toDigits(o.telefoon_e164 || o.telefoon_nummer || "");
      if (!to) {
        failCount += 1;
        details.push(`Order ${o.order_nummer}: geen geldig telefoonnummer`);
        continue;
      }

      const templateComponents: Array<Record<string, unknown>> = [];
      if (headerVariables.length > 0) {
        templateComponents.push({
          type: "header",
          parameters: headerVariables.map((text) => ({
            type: "text",
            text: fillTemplateVar(text, o),
          })),
        });
      }
      if (bodyVariables.length > 0) {
        templateComponents.push({
          type: "body",
          parameters: bodyVariables.map((text) => ({
            type: "text",
            text: fillTemplateVar(text, o),
          })),
        });
      }

      const payload: Record<string, unknown> = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(templateComponents.length > 0 ? { components: templateComponents } : {}),
        },
      };

      const waRes = await fetch(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${waToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const waJson = await waRes.json().catch(() => ({}));
      if (!waRes.ok) {
        failCount += 1;
        const errMsg =
          (waJson?.error?.message as string | undefined) ??
          `WhatsApp fout (${waRes.status})`;
        details.push(`Order ${o.order_nummer}: ${errMsg}`);
      } else {
        sentCount += 1;
        details.push(`Order ${o.order_nummer}: verzonden`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `${sentCount} verzonden, ${failCount} mislukt.`,
      details,
      orders: selected.map((o) => ({
        order_nummer: o.order_nummer,
        naam: o.naam,
        tijdslot: o.aankomsttijd_slot,
        telefoon: o.telefoon_e164 || o.telefoon_e164,
      })),
    });
  } catch (e) {
    console.error("[api/stuur-appjes]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
