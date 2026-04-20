import { maySendWhatsAppForOwner } from "@/lib/account";

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
  bestelling_totaal_prijs?: number | string | null;
  telefoon_e164?: string | null;
  telefoon_nummer?: string | null;
  type?: string | null;
  betaald?: boolean | null;
  mp_tags?: string | null;
  datum?: string | null;
  opmerkingen_klant?: string | null;
  bezorgtijd_voorkeur?: string | null;
  /** True wanneer de order op verzendmoment in zowel ritjes_vandaag als planning staat. */
  in_planning_en_ritjes_vandaag?: boolean | null;
};

export type SendWhatsAppResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  messageId?: string;
};

type WaTemplateComponent = {
  type?: string;
  text?: string;
  format?: string;
};

type WaTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: WaTemplateComponent[];
};

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

/** Meta template language for `nieuw_tijdslot` — must match Business Manager exactly (e.g. en, en_US). */
function nieuwTijdslotTemplateLanguage(): string {
  const fromEnv = env("WHATSAPP_NIEUW_TIJDSLOT_LANGUAGE");
  if (fromEnv) return fromEnv;
  return "en";
}

function normalizePhone(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return "";

  // Keep explicit international formats.
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("00")) return cleaned.slice(2);

  // Dutch local mobile/landline fallback (e.g. 06..., 010..., 020...).
  if (cleaned.startsWith("0")) return `31${cleaned.slice(1)}`;

  // Already country-coded without plus.
  if (cleaned.startsWith("31")) return cleaned;

  // Last resort: keep digits and let WA validate.
  return cleaned;
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

function isMpOrder(order: WhatsAppOrderInput): boolean {
  const t = String(order.type ?? "").toLowerCase();
  if (t === "mp_winkel") return true;
  return /\bmp\b/.test(String(order.mp_tags ?? "").toLowerCase());
}

function resolveFixedBusinessTemplate(
  event: WhatsAppEvent,
  order: WhatsAppOrderInput
): TemplateConfig | null {
  const kind = getOrderKind(order);
  const paid = order.betaald === true;
  const mp = isMpOrder(order);
  const inPlanningEnRitjesVandaag = order.in_planning_en_ritjes_vandaag === true;

  if (event === "planning_goedgekeurd" || event === "stuur_appjes") {
    if (inPlanningEnRitjesVandaag) {
      return { name: "nieuw_tijdslot", language: nieuwTijdslotTemplateLanguage() };
    }
    if (kind === "terugbrengen") return { name: "fatbike_terugbrengen", language: "nl" };
    if (kind === "ophalen") return { name: "fatbike_ophalen", language: "nl" };
    if (kind === "reparatie_aan_huis" || kind === "proefrit") {
      return { name: "bezorgtijd_proefrit_aan_huis", language: "nl" };
    }
    if (mp) return { name: "bezorgtijd_bij_mp_bestellingen", language: "nl_BE" };
    if (paid) return { name: "bezorgtijd_bij_betaalde_bestellingen", language: "nl_BE" };
    return { name: "bezorgtijd_bij_niet_betaalde_bestellingen", language: "nl_BE" };
  }

  if (event === "afronden") {
    if (kind === "terugbrengen") return { name: "bevestiging_terugbrengen", language: "nl" };
    if (kind === "ophalen") return { name: "bevestiging_na_ophalen", language: "nl" };
    if (kind === "reparatie_aan_huis") return { name: "bevestiging_reparatie_aan_huis", language: "nl" };
    if (kind === "proefrit") return { name: "bevestiging_na_proefrit_aan_huis", language: "nl" };
    return { name: "review_vragen_na_bezorging", language: "nl_BE" };
  }
  return null;
}

export function resolveConfiguredTemplateForOrder(
  event: WhatsAppEvent,
  order: WhatsAppOrderInput
): TemplateConfig | null {
  return resolveFixedBusinessTemplate(event, order) ?? resolveTemplateForOrder(event, order);
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

function slug(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function eventKeywords(event: WhatsAppEvent): string[] {
  if (event === "planning_goedgekeurd") return ["planning", "goedgekeurd", "tijdslot"];
  if (event === "stuur_appjes") return ["stuur", "appjes", "tijdslot", "update"];
  return ["afronden", "afgerond", "geleverd", "bezorgd"];
}

function kindKeywords(kind: OrderKind): string[] {
  if (kind === "ophalen") return ["ophalen", "reparatie_ophalen"];
  if (kind === "terugbrengen") return ["terugbrengen", "reparatie_terugbrengen"];
  if (kind === "reparatie_aan_huis") return ["reparatie_aan_huis", "aan_huis", "reparatie_deur"];
  if (kind === "proefrit") return ["proefrit"];
  if (kind === "verkoop") return ["verkoop", "normaal", "default"];
  return ["default"];
}

function fillVars(template: string, order: WhatsAppOrderInput): string {
  return String(template ?? "")
    .replaceAll("{naam}", String(order.naam ?? ""))
    .replaceAll("{order_nummer}", String(order.order_nummer ?? ""))
    .replaceAll("{tijdslot}", String(order.aankomsttijd_slot ?? ""));
}

/** DD-MM for WhatsApp {datum}: vandaag vóór 19:00 Amsterdam, anders morgen (op verzendmoment). */
function formatDatumPlaceholderAmsterdam(): string {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const [datePart, timePart] = s.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const hour = Number(timePart.split(":")[0]);
  let yy = y;
  let mm = m;
  let dd = d;
  if (hour >= 19) {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    yy = next.getUTCFullYear();
    mm = next.getUTCMonth() + 1;
    dd = next.getUTCDate();
  }
  return `${String(dd).padStart(2, "0")}-${String(mm).padStart(2, "0")}`;
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

function countTemplateParamsInText(text: string | undefined): number {
  const matches = String(text ?? "").match(/\{\{\d+\}\}/g);
  return matches ? matches.length : 0;
}

function extractParamCount(tpl: WaTemplate, componentType: "BODY" | "HEADER"): number {
  const comp = (tpl.components ?? []).find(
    (c) => String(c.type ?? "").toUpperCase() === componentType
  );
  return countTemplateParamsInText(comp?.text);
}

function buildAutoVariables(
  event: WhatsAppEvent,
  order: WhatsAppOrderInput,
  count: number
): string[] {
  const common = [
    String(order.naam ?? ""),
    String(order.aankomsttijd_slot ?? ""),
    String(order.order_nummer ?? ""),
  ];
  const eventSpecific =
    event === "afronden"
      ? [String(order.order_nummer ?? ""), String(order.naam ?? "")]
      : [String(order.naam ?? ""), String(order.aankomsttijd_slot ?? ""), String(order.order_nummer ?? "")];
  const source = [...eventSpecific, ...common];
  return Array.from({ length: Math.max(0, count) }, (_, i) => source[i] ?? "");
}

function buildBusinessVariables(order: WhatsAppOrderInput, count: number): string[] {
  const vars = [
    String(order.naam ?? ""),
    formatDatumPlaceholderAmsterdam(),
    String(order.aankomsttijd_slot ?? ""),
    String(order.bestelling_totaal_prijs ?? ""),
  ];
  return Array.from({ length: Math.max(0, count) }, (_, i) => vars[i] ?? "");
}

function buildNieuwTijdslotVariables(order: WhatsAppOrderInput, count: number): string[] {
  const vars = [
    String(order.naam ?? ""),
    String(order.aankomsttijd_slot ?? ""),
    String(order.order_nummer ?? ""),
  ];
  return Array.from({ length: Math.max(0, count) }, (_, i) => vars[i] ?? "");
}

let templatesCache: { expiresAt: number; templates: WaTemplate[] } | null = null;

async function getCachedTemplates(): Promise<WaTemplate[]> {
  const now = Date.now();
  if (templatesCache && templatesCache.expiresAt > now) return templatesCache.templates;
  const fetched = await fetchWhatsAppTemplates();
  if (!fetched.ok) return [];
  const templates = (fetched.templates as WaTemplate[]) ?? [];
  templatesCache = { templates, expiresAt: now + 2 * 60 * 1000 }; // 2 min cache
  return templates;
}

async function resolveAutoTemplate(
  event: WhatsAppEvent,
  order: WhatsAppOrderInput
): Promise<WaTemplate | null> {
  const kind = getOrderKind(order);
  const tpls = await getCachedTemplates();
  const active = tpls.filter(
    (t) => String(t.status ?? "").toUpperCase() === "APPROVED" && t.name
  );
  if (active.length === 0) return null;

  const eKeys = eventKeywords(event).map(slug);
  const kKeys = kindKeywords(kind).map(slug);

  let best: { tpl: WaTemplate; score: number } | null = null;
  for (const tpl of active) {
    const name = slug(String(tpl.name ?? ""));
    let score = 0;
    for (const k of eKeys) if (name.includes(k)) score += 3;
    for (const k of kKeys) if (name.includes(k)) score += 4;
    if (name.includes("default")) score += 1;
    if (!best || score > best.score) best = { tpl, score };
  }
  if (!best || best.score <= 0) return null;
  return best.tpl;
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
  order: WhatsAppOrderInput,
  ctx?: { ownerEmail?: string | null }
): Promise<SendWhatsAppResult> {
  const gate = maySendWhatsAppForOwner(ctx?.ownerEmail ?? null, order);
  if (!gate.ok) {
    return { ok: false, skipped: true, error: gate.error };
  }

  const to = String(order.telefoon_e164 || order.telefoon_nummer || "");

  // 0) Vaste businessregels (harde mapping)
  const fixed = resolveFixedBusinessTemplate(event, order);
  if (fixed?.name) {
    const templates = await getCachedTemplates();
    const tpl = templates.find((t) => String(t.name) === fixed.name);
    const bodyCount = tpl ? extractParamCount(tpl, "BODY") : 0;
    const headerCount = tpl ? extractParamCount(tpl, "HEADER") : 0;
    const buildVars =
      fixed.name === "nieuw_tijdslot" ? buildNieuwTijdslotVariables : buildBusinessVariables;
    return sendWhatsAppTemplate({
      to,
      templateName: fixed.name,
      languageCode: fixed.language || "nl",
      bodyVariables: buildVars(order, bodyCount),
      headerVariables: buildVars(order, headerCount),
    });
  }

  // 1) Voorkeur: expliciete mapping uit env
  const mapped = resolveTemplateForOrder(event, order);
  if (mapped?.name) {
    const bodyVariables = (mapped.bodyVariables ?? []).map((v) => fillVars(v, order));
    const headerVariables = (mapped.headerVariables ?? []).map((v) => fillVars(v, order));
    return sendWhatsAppTemplate({
      to,
      templateName: mapped.name,
      languageCode: mapped.language || "nl",
      bodyVariables,
      headerVariables,
    });
  }

  // 2) Fallback: automatisch template kiezen op basis van event + ordertype
  const autoTemplate = await resolveAutoTemplate(event, order);
  if (!autoTemplate?.name) {
    return {
      ok: false,
      skipped: true,
      error: `Geen template gevonden voor event '${event}' en type '${getOrderKind(order)}'.`,
    };
  }

  const bodyCount = extractParamCount(autoTemplate, "BODY");
  const headerCount = extractParamCount(autoTemplate, "HEADER");
  const bodyVariables = buildBusinessVariables(order, bodyCount);
  const headerVariables = buildBusinessVariables(order, headerCount);

  return sendWhatsAppTemplate({
    to,
    templateName: String(autoTemplate.name),
    languageCode: String(autoTemplate.language ?? "nl"),
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
    `?fields=name,language,status,category,id,components&limit=200`;
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

