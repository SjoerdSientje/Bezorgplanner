import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type WhatsAppInboundMessage = {
  id?: string;
  from?: string;
  type?: string;
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppInboundMessage[];
      };
    }>;
  }>;
};

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function normalizePhone(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("00")) return cleaned.slice(2);
  if (cleaned.startsWith("0")) return `31${cleaned.slice(1)}`;
  if (cleaned.startsWith("31")) return cleaned;
  return cleaned;
}

function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = env("WHATSAPP_APP_SECRET");
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function sendTextMessage(toRaw: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const waToken = env("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId || !waToken) {
    return { ok: false, error: "WHATSAPP_PHONE_NUMBER_ID of WHATSAPP_ACCESS_TOKEN ontbreekt." };
  }
  const to = normalizePhone(toRaw);
  if (!to) return { ok: false, error: "Geen geldig telefoonnummer voor auto-reply." };

  const res = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${waToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (json?.error?.message as string | undefined) ?? `WhatsApp auto-reply fout (${res.status})`,
    };
  }
  return { ok: true };
}

function extractIncomingMessages(payload: WhatsAppWebhookPayload): WhatsAppInboundMessage[] {
  const out: WhatsAppInboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (!message?.from) continue;
        out.push(message);
      }
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expectedToken = env("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

  if (!expectedToken) {
    return NextResponse.json(
      { error: "WHATSAPP_WEBHOOK_VERIFY_TOKEN ontbreekt." },
      { status: 500 }
    );
  }

  if (mode === "subscribe" && token === expectedToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Webhook verificatie mislukt." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Ongeldige webhook signature." }, { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Ongeldige webhook payload." }, { status: 400 });
  }

  const replyText =
    env("WHATSAPP_INBOUND_AUTO_REPLY_TEXT") ||
    "Goedendag,\n\nDit nummer kan helaas geen whatsapp berichten ontvangen. Wil je toch contact met ons opnemen? Bel ons op +31854016006, of stuur ons een whatsapp bericht op +31687139057. Bedankt!\n\nMet vriendelijke groet,\nTeam Koopjefatbike";

  const messages = extractIncomingMessages(payload);
  let sent = 0;
  for (const message of messages) {
    const sentResult = await sendTextMessage(String(message.from ?? ""), replyText);
    if (!sentResult.ok) {
      console.error("[webhooks/whatsapp] auto-reply fout:", sentResult.error, {
        from: message.from,
        messageId: message.id,
        type: message.type,
      });
      continue;
    }
    sent += 1;
  }

  return NextResponse.json({ ok: true, received: messages.length, autoRepliesSent: sent }, { status: 200 });
}
