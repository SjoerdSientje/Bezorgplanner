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
  /** YYYY-MM-DD: lever-/planningsdatum voor template (niet de besteldatum). */
  datum?: string | null;
  opmerkingen_klant?: string | null;
  bezorgtijd_voorkeur?: string | null;
  /** True wanneer de order op verzendmoment in zowel ritjes_vandaag als planning staat. */
  in_planning_en_ritjes_vandaag?: boolean | null;
  /**
   * Alleen gezet door "stuur appjes" → "nieuwe order": forceert het woord "vandaag"/"morgen"
   * in het bericht (i.p.v. een datum-string), gebaseerd op de 18:00-Amsterdam-rollover op
   * verzendmoment. Andere flows (planning goedkeuren, nieuw tijdslot) laten dit veld leeg en
   * behouden hun bestaande datum-weergave.
   */
  leveringLabelOverride?: "vandaag" | "morgen" | null;
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
    if (kind === "reparatie_aan_huis") {
      return { name: "bezorgtijd_reperatie_aan_huis", language: "nl" };
    }
    if (kind === "proefrit") {
      return { name: "bezorgtijd_proefrit_aan_huis", language: "nl" };
    }
    if (mp && paid) return { name: "bezorgtijd_bij_betaalde_bestellingen", language: "nl_BE" };
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

function formatAsDdMm(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseIsoDateKey(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  // Supports YYYY-MM-DD (orders.datum) and other ISO-like values.
  const isoLike = /^\d{4}-\d{2}-\d{2}/.exec(s);
  if (isoLike) {
    const [y, m, d] = isoLike[0].split("-").map(Number);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      return new Date(y, m - 1, d);
    }
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** DD-MM for WhatsApp-body: `datum` = lever-/planningsdatum (YYYY-MM-DD); anders vandaag Amsterdam. */
function formatDatumPlaceholderAmsterdam(order: WhatsAppOrderInput): string {
  const fromPlanning = parseIsoDateKey(String(order.datum ?? ""));
  if (fromPlanning) return formatAsDdMm(fromPlanning);

  const s = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const [datePart] = s.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return formatAsDdMm(new Date(y, m - 1, d));
  }
  return "";
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
    order.leveringLabelOverride ?? formatDatumPlaceholderAmsterdam(order),
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
  /** Named body params (parameter_format: named), e.g. { productnaam: "..." } */
  bodyNamedVariables?: Record<string, string>;
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

  const namedEntries = Object.entries(params.bodyNamedVariables ?? {}).filter(
    ([, v]) => String(v ?? "").trim() !== ""
  );
  if (namedEntries.length > 0) {
    components.push({
      type: "body",
      parameters: namedEntries.map(([parameter_name, text]) => ({
        type: "text",
        parameter_name,
        text: String(text).slice(0, 1024),
      })),
    });
  } else if ((params.bodyVariables ?? []).length > 0) {
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

/** Vast nummer voor voorraad-alerts (overschrijfbaar via WHATSAPP_VOORRAAD_ALERT_TO). */
export const INVENTORY_ALERT_PHONE_DEFAULT = "31687139057";

export const INVENTORY_ALERT_TEMPLATE_LOW = "voorraad_laag_3";
export const INVENTORY_ALERT_TEMPLATE_OUT = "voorraad_uitverkocht";

/** @deprecated gebruik INVENTORY_ALERT_TEMPLATE_LOW / _OUT */
export const INVENTORY_ALERT_TEMPLATE_DEFAULT = INVENTORY_ALERT_TEMPLATE_LOW;

export async function sendWhatsAppText(params: {
  to: string;
  text: string;
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
  if (!to) return { ok: false, error: "Geen geldig telefoonnummer." };

  const body = String(params.text ?? "").trim();
  if (!body) return { ok: false, error: "Lege WhatsApp-tekst." };

  const waRes = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${waToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: body.slice(0, 4096) },
    }),
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

type InventoryTemplateSpec = {
  name: string;
  bodyText: string;
  exampleProduct: string;
};

const INVENTORY_ALERT_TEMPLATE_SPECS: InventoryTemplateSpec[] = [
  {
    name: INVENTORY_ALERT_TEMPLATE_LOW,
    bodyText: "De voorraad van {{productnaam}} is laag (3).",
    exampleProduct: "Fatbike Zwart",
  },
  {
    name: INVENTORY_ALERT_TEMPLATE_OUT,
    bodyText: "Waarschuwing! {{productnaam}} is uitverkocht, bestel bij!",
    exampleProduct: "Fatbike Zwart",
  },
];

export type InventoryTemplateCreateResult = {
  name: string;
  language: string;
  ok: boolean;
  id?: string;
  status?: string;
  error?: string;
  alreadyExists?: boolean;
};

async function createNamedUtilityTemplate(params: {
  wabaId: string;
  token: string;
  name: string;
  language: string;
  bodyText: string;
  exampleProduct: string;
}): Promise<InventoryTemplateCreateResult> {
  const { wabaId, token, name, language, bodyText, exampleProduct } = params;

  const res = await fetch(
    `https://graph.facebook.com/v22.0/${wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        language,
        category: "UTILITY",
        allow_category_change: true,
        parameter_format: "named",
        components: [
          {
            type: "BODY",
            text: bodyText,
            example: {
              body_text_named_params: [
                { param_name: "productnaam", example: exampleProduct },
              ],
            },
          },
        ],
      }),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json?.error?.message as string | undefined) ??
      `Template aanmaken mislukt (${res.status})`;
    const already = /already exists|duplicate|taken/i.test(msg);
    return { name, language, ok: false, error: msg, alreadyExists: already };
  }

  return {
    name,
    language,
    ok: true,
    id: json?.id ? String(json.id) : undefined,
    status: json?.status ? String(json.status) : "PENDING",
  };
}

/**
 * Dient beide voorraad-templates in bij Meta (laag=3 en uitverkocht=0).
 */
export async function createInventoryAlertTemplates(): Promise<
  | { ok: true; language: string; results: InventoryTemplateCreateResult[] }
  | { ok: false; error: string; results?: InventoryTemplateCreateResult[] }
> {
  const wabaId = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const token = env("WHATSAPP_ACCESS_TOKEN");
  if (!wabaId || !token) {
    return {
      ok: false,
      error: "WHATSAPP_BUSINESS_ACCOUNT_ID of WHATSAPP_ACCESS_TOKEN ontbreekt.",
    };
  }

  const language = env("WHATSAPP_VOORRAAD_ALERT_LANGUAGE") || "nl";
  const existing = await fetchWhatsAppTemplates();
  const results: InventoryTemplateCreateResult[] = [];

  for (const spec of INVENTORY_ALERT_TEMPLATE_SPECS) {
    const found =
      existing.ok &&
      (existing.templates ?? []).find(
        (t) =>
          String(t.name ?? "") === spec.name &&
          String(t.language ?? "").toLowerCase().startsWith(language.toLowerCase().slice(0, 2))
      );

    if (found) {
      results.push({
        name: spec.name,
        language: String(found.language ?? language),
        ok: true,
        id: found.id ? String(found.id) : undefined,
        status: found.status ? String(found.status) : undefined,
        alreadyExists: true,
      });
      continue;
    }

    results.push(
      await createNamedUtilityTemplate({
        wabaId,
        token,
        name: spec.name,
        language,
        bodyText: spec.bodyText,
        exampleProduct: spec.exampleProduct,
      })
    );
  }

  const allOk = results.every((r) => r.ok || r.alreadyExists);
  if (!allOk) {
    const firstErr = results.find((r) => !r.ok)?.error ?? "Template(s) aanmaken mislukt.";
    return { ok: false, error: firstErr, results };
  }

  return { ok: true, language, results };
}

/** @deprecated gebruik createInventoryAlertTemplates */
export async function createInventoryAlertTemplate() {
  const res = await createInventoryAlertTemplates();
  if (!res.ok) {
    return {
      ok: false as const,
      error: res.error,
      alreadyExists: res.results?.some((r) => r.alreadyExists),
    };
  }
  const first = res.results[0]!;
  return {
    ok: true as const,
    id: first.id,
    status: first.status,
    name: first.name,
    language: res.language,
  };
}

/**
 * Appje bij voorraad 3 of 0 met de juiste Meta-template.
 */
export async function notifyInventoryStockAlert(params: {
  productTitle: string;
  stockAfter: number;
}): Promise<SendWhatsAppResult> {
  const to = env("WHATSAPP_VOORRAAD_ALERT_TO") || INVENTORY_ALERT_PHONE_DEFAULT;
  const title = String(params.productTitle ?? "").trim() || "Product";
  const stock = Math.max(0, Math.floor(params.stockAfter));
  const productnaam = title.slice(0, 200);

  const text =
    stock === 0
      ? `Waarschuwing! ${title} is uitverkocht, bestel bij!`
      : `De voorraad van ${title} is laag (3).`;

  const templateName =
    stock === 0
      ? env("WHATSAPP_VOORRAAD_OUT_TEMPLATE") || INVENTORY_ALERT_TEMPLATE_OUT
      : env("WHATSAPP_VOORRAAD_LOW_TEMPLATE") || INVENTORY_ALERT_TEMPLATE_LOW;

  const tplRes = await sendWhatsAppTemplate({
    to,
    templateName,
    languageCode: env("WHATSAPP_VOORRAAD_ALERT_LANGUAGE") || "nl",
    bodyNamedVariables: { productnaam },
  });
  if (tplRes.ok) return tplRes;
  console.warn("[whatsapp] voorraad template mislukt, probeer tekst:", tplRes.error);

  return sendWhatsAppText({ to, text });
}

