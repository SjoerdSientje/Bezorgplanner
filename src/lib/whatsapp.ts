export type WhatsAppEvent = "planning_goedgekeurd" | "stuur_appjes" | "afronden";

export type OrderKind =
  | "verkoop"
  | "ophalen"
  | "terugbrengen"
  | "reparatie_aan_huis"
  | "proefrit"
  | "default";

export type TemplateConfig = {
  name: string;
  language?: string;
  bodyVariables?: string[];
  headerVariables?: string[];
};

type TemplateMap = Partial<
  Record<WhatsAppEvent, Partial<Record<OrderKind | "default", TemplateConfig>>>
>;

export type WhatsAppOrderInput = {
  order_nummer?: string | null;
  naam?: string | null;
  aankomsttijd_slot?: string | null;
  telefoon_e164?: string | null;
  telefoon_nummer?: string | null;
  type?: string | null;
  opmerkingen_klant?: string | null;
  bezorgtijd_voorkeur?: string | null;
};

export type SendWhatsAppResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  messageId?: string;
};

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function normalizePhone(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
}

export function getOrderKind(order: WhatsAppOrderInput): OrderKind {
  const t = String(order.type ?? "").toLowerCase();
  if (t === "reparatie_ophalen") return "ophalen";
  if (t === "reparatie_terugbrengen") return "terugbrengen";
  if (t === "reparatie_deur") return "reparatie_aan_huis";
  if (t === "verkoop") {
    const hint = `${order.opmerkingen_klant ?? ""} ${order.bezorgtijd_voorkeur ?? ""}`.toLowerCase();
    if (hint.includes("proefrit")) return "proefrit";
    return "verkoop";
  }
  return "default";
}

function parseTemplateMap(): TemplateMap {
  const raw = env("WHATSAPP_TEMPLATE_MAP_JSON");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as TemplateMap;
  } catch {
    return {};
  }
}

function fillVars(template: string, order: WhatsAppOrderInput): string {
  return String(template ?? "")
    .replaceAll("{naam}", String(order.naam ?? ""))
    .replaceAll("{order_nummer}", String(order.order_nummer ?? ""))
    .replaceAll("{tijdslot}", String(order.aankomsttijd_slot ?? ""));
}

export function resolveTemplateForOrder(
  event: WhatsAppEvent,
  order: WhatsAppOrderInput
): TemplateConfig | null {
  const map = parseTemplateMap();
  const eventMap = map[event];
  if (!eventMap) return null;
  const kind = getOrderKind(order);
  return eventMap[kind] ?? eventMap.default ?? null;
}

export async function sendWhatsAppTemplate(params: {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyVariables?: string[];
  headerVariables?: string[];
}): Promise<SendWhatsAppResult> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const waToken = env("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId || !waToken) {
    return {
      ok: false,
      error: "WHATSAPP_PHONE_NUMBER_ID of WHATSAPP_ACCESS_TOKEN ontbreekt.",
    };
  }

  const to = normalizePhone(params.to);
  if (!to) {
    return { ok: false, error: "Geen geldig telefoonnummer." };
  }

  const components: Array<Record<string, unknown>> = [];
  if ((params.headerVariables ?? []).length > 0) {
    components.push({
      type: "header",
      parameters: (params.headerVariables ?? []).map((text) => ({ type: "text", text })),
    });
  }
  if ((params.bodyVariables ?? []).length > 0) {
    components.push({
      type: "body",
      parameters: (params.bodyVariables ?? []).map((text) => ({ type: "text", text })),
    });
  }

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.languageCode || "nl" },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const waRes = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${waToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const waJson = await waRes.json().catch(() => ({}));
  if (!waRes.ok) {
    return {
      ok: false,
      error:
        (waJson?.error?.message as string | undefined) ??
        `WhatsApp fout (${waRes.status})`,
    };
  }

  return {
    ok: true,
    messageId: waJson?.messages?.[0]?.id as string | undefined,
  };
}

export async function sendWhatsAppByEvent(
  event: WhatsAppEvent,
  order: WhatsAppOrderInput
): Promise<SendWhatsAppResult> {
  const template = resolveTemplateForOrder(event, order);
  if (!template?.name) {
    return {
      ok: false,
      skipped: true,
      error: `Geen template-config voor event '${event}' en type '${getOrderKind(order)}'.`,
    };
  }

  const to = String(order.telefoon_e164 ?? order.telefoon_nummer ?? "");
  const bodyVariables = (template.bodyVariables ?? []).map((v) => fillVars(v, order));
  const headerVariables = (template.headerVariables ?? []).map((v) => fillVars(v, order));

  return sendWhatsAppTemplate({
    to,
    templateName: template.name,
    languageCode: template.language || "nl",
    bodyVariables,
    headerVariables,
  });
}

export async function fetchWhatsAppTemplates() {
  const wabaId = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const token = env("WHATSAPP_ACCESS_TOKEN");
  if (!wabaId || !token) {
    return { ok: false as const, error: "WHATSAPP_BUSINESS_ACCOUNT_ID of WHATSAPP_ACCESS_TOKEN ontbreekt." };
  }

  const url =
    `https://graph.facebook.com/v22.0/${wabaId}/message_templates` +
    `?fields=name,language,status,category,id&limit=200`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false as const,
      error: (json?.error?.message as string | undefined) ?? `Template fetch fout (${res.status})`,
    };
  }
  return {
    ok: true as const,
    templates: (json?.data ?? []) as Array<Record<string, unknown>>,
  };
}

