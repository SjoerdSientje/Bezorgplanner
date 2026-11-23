import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mayCreateMoneybirdInvoicesForOwner,
  requireAccountEmail,
} from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import { buildPlanningAgentSystemPrompt } from "@/lib/agent/system-prompt";
import {
  formatKennisVoorTool,
  zoekAppKennis,
} from "@/lib/agent/app-kennis";
import { raadpleegMoneybirdApi } from "@/lib/agent/moneybird-capabilities";
import { isDatumOpmerkingVandaagOfMorgen } from "@/lib/planning-date";
import { isIncompleteMpOrder, isMpPausedForOwner } from "@/lib/mp-pause";
import {
  isMoneybirdConfigured,
  sendReparatieSalesInvoice,
  sendSalesInvoiceByEmail,
  fetchSalesInvoiceById,
  isDraftMoneybirdInvoice,
} from "@/lib/moneybird";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export const maxDuration = 60;

type RitjesOrder = {
  id?: string;
  order_nummer: string | null;
  naam: string | null;
  adres_url: string | null;
  bel_link: string | null;
  aankomsttijd_slot: string | null;
  bezorgtijd_voorkeur: string | null;
  meenemen_in_planning?: boolean | null;
  nieuw_appje_sturen?: boolean | null;
  datum_opmerking: string | null;
  opmerkingen_klant: string | null;
  producten: string | null;
  bestelling_totaal_prijs?: number | null;
  betaald?: boolean | null;
  volledig_adres: string | null;
  telefoon_nummer: string | null;
  order_id: string | null;
  datum: string | null;
  aantal_fietsen?: number | null;
  email: string | null;
  telefoon_e164: string | null;
  model: string | null;
  serienummer: string | null;
  mp_tags: string | null;
};

function isEligibleOrder(o: RitjesOrder): boolean {
  if (!o.meenemen_in_planning) return false;
  return isDatumOpmerkingVandaagOfMorgen(o.datum_opmerking);
}

function formatOrderForContext(o: RitjesOrder): string {
  const slot = o.aankomsttijd_slot?.trim() ?? "";
  const slotStr = slot ? slot : "(nog geen slot)";
  return `Order ${o.order_nummer ?? "?"} | ${o.naam ?? ""} | Adres: ${o.volledig_adres ?? ""} | Aankomsttijd (tijdslot): ${slotStr} | Bezorgtijd voorkeur (tijdsvenster/restrictie): ${o.bezorgtijd_voorkeur ?? "-"} | Datum opmerking: ${o.datum_opmerking ?? "-"} | Aantal fietsen: ${o.aantal_fietsen ?? ""}`;
}

function buildContextBlock(ritjesOrders: RitjesOrder[]): string {
  const eligible = ritjesOrders.filter(isEligibleOrder);
  if (eligible.length === 0) {
    return "\n\nEr zijn momenteel geen ritjes-orders in de client-context die aan de criteria voldoen (datum-opmerking = vandaag of morgen én meenemen in planning = ja). Gebruik zoek_orders indien nodig.";
  }
  const withSlot = eligible.filter(
    (o) => (o.aankomsttijd_slot ?? "").trim().length > 0
  );
  const withoutSlot = eligible.filter(
    (o) => !(o.aankomsttijd_slot ?? "").trim().length
  );
  let block =
    "\n\nOrders in ritjes-context (datum-opmerking vandaag/morgen, meenemen = ja):\n" +
    eligible.map(formatOrderForContext).join("\n");
  if (withSlot.length > 0) {
    block +=
      "\n\n**Belangrijk:** Rijen met tijdslot vormen de huidige geplande route. Orders zonder tijdslot zitten nog niet in de route.";
  }
  if (withoutSlot.length > 0 && withSlot.length > 0) {
    block += ` Momenteel ${withSlot.length} met slot, ${withoutSlot.length} zonder.`;
  }
  block +=
    "\n\nRoep **set_aankomsttijd_slots** alleen aan na **expliciete bevestiging**.";
  return block;
}

function toolDefs(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "zoek_app_kennis",
        description:
          "Zoek in de Bezorgplanner-handleiding en processkennis. Gebruik bij vragen over wat er gebeurt bij acties, ophalen, reparaties, koppelingen, voorraad.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Zoekvraag of trefwoorden in het Nederlands",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "raadpleeg_moneybird_api",
        description:
          "Raadpleeg wat Moneybird/onze koppeling kan (capabilities + optioneel officiële docs). Gebruik vóór je Moneybird-acties belooft of uitvoert.",
        parameters: {
          type: "object",
          properties: {
            vraag: {
              type: "string",
              description: "Wat wil de gebruiker weten of doen in Moneybird?",
            },
            docs_url: {
              type: "string",
              description:
                "Optioneel: https://developer.moneybird.com/api/... whitelist-URL",
            },
          },
          required: ["vraag"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "zoek_orders",
        description:
          "Zoek orders van dit account op order_nummer, klantnaam of e-mail.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Ordernummer (#123), naam of e-mail",
            },
            limit: {
              type: "number",
              description: "Max resultaten (default 8, max 15)",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_aankomsttijd_slots",
        description:
          "Zet, wijzig of wis klanttijdsloten (Aankomsttijd) voor ritjes-orders. Alleen na expliciete bevestiging. Match op order_nummer.",
        parameters: {
          type: "object",
          properties: {
            updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  order_nummer: { type: "string" },
                  aankomsttijd_slot: {
                    type: "string",
                    description:
                      "HH:MM - HH:MM, of leeg/'verwijder' om te wissen",
                  },
                },
                required: ["order_nummer", "aankomsttijd_slot"],
              },
            },
          },
          required: ["updates"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "stuur_moneybird_factuur",
        description:
          "Verstuur de bestaande Moneybird-factuur van een order per e-mail. Alleen na bevestiging. Order moet moneybird_invoice_id hebben.",
        parameters: {
          type: "object",
          properties: {
            order_nummer: {
              type: "string",
              description: "Ordernummer (met of zonder #)",
            },
            order_id: {
              type: "string",
              description: "Optioneel intern order-id",
            },
            email: {
              type: "string",
              description: "Optioneel e-mailadres override",
            },
          },
        },
      },
    },
  ];
}

function fnArgs(tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall): {
  name: string;
  arguments: string;
  id: string;
} | null {
  const fn = (tc as { function?: { name?: string; arguments?: string } })
    .function;
  if (!fn?.name) return null;
  return {
    name: fn.name,
    arguments: fn.arguments ?? "{}",
    id: tc.id,
  };
}

async function handleZoekOrders(
  supabase: Db,
  ownerEmail: string,
  rawArgs: string
): Promise<string> {
  let args: { query?: string; limit?: number };
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return JSON.stringify({ error: "Ongeldige parameters." });
  }
  const q = String(args.query ?? "").trim();
  if (!q) return JSON.stringify({ error: "query is verplicht." });
  const limit = Math.min(15, Math.max(1, Math.floor(Number(args.limit) || 8)));

  // PostgREST .or() is gevoelig voor , ( ) — strip die uit de zoekterm.
  const safe = q.replace(/[%(),]/g, " ").replace(/\s+/g, " ").trim();
  if (!safe) return JSON.stringify({ error: "query is ongeldig." });
  const alt = safe.startsWith("#") ? safe.slice(1) : `#${safe}`;
  const orParts = [
    `order_nummer.eq.${safe}`,
    `order_nummer.eq.${alt}`,
    `naam.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
  ];

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_nummer, naam, email, status, type, source, volledig_adres, moneybird_invoice_id, bestelling_totaal_prijs, aankomsttijd_slot, meenemen_in_planning, datum_opmerking"
    )
    .eq("owner_email", ownerEmail)
    .or(orParts.join(","))
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    count: data?.length ?? 0,
    orders: (data ?? []).map((o) => ({
      id: o.id,
      order_nummer: o.order_nummer,
      naam: o.naam,
      email: o.email,
      status: o.status,
      type: o.type,
      source: o.source,
      adres: o.volledig_adres,
      moneybird_invoice_id: o.moneybird_invoice_id ?? null,
      totaal: o.bestelling_totaal_prijs,
      aankomsttijd_slot: o.aankomsttijd_slot,
      meenemen_in_planning: o.meenemen_in_planning,
      datum_opmerking: o.datum_opmerking,
    })),
  });
}

async function handleSetSlots(
  supabase: Db,
  ownerEmail: string,
  rawArgs: string,
  mpPaused: boolean
): Promise<{ content: string; slotsUpdated: boolean }> {
  let args: {
    updates?: Array<{ order_nummer: string; aankomsttijd_slot: string }>;
  };
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return {
      content: JSON.stringify({ error: "Ongeldige parameters." }),
      slotsUpdated: false,
    };
  }
  const updates = args.updates ?? [];
  const results: string[] = [];
  let slotsUpdated = false;

  for (const u of updates) {
    const onr = String(u.order_nummer ?? "").trim();
    const slotRaw = String(u.aankomsttijd_slot ?? "").trim();
    const clearSlot =
      slotRaw === "" || /^(verwijder|leeg|wis|clear)$/i.test(slotRaw);
    if (!onr) continue;

    let orderId: string | null = null;
    const baseQuery = () =>
      supabase
        .from("orders")
        .select("id, datum_opmerking, source, status, mp_tags, order_nummer")
        .eq("owner_email", ownerEmail)
        .eq("status", "ritjes_vandaag")
        .eq("meenemen_in_planning", true)
        .limit(1);

    const { data: byExact } = await baseQuery()
      .eq("order_nummer", onr)
      .maybeSingle();
    if (
      byExact?.id &&
      isDatumOpmerkingVandaagOfMorgen(byExact.datum_opmerking) &&
      !(mpPaused && isIncompleteMpOrder(byExact))
    ) {
      orderId = byExact.id;
    }
    if (!orderId) {
      const alt = onr.startsWith("#") ? onr.slice(1) : "#" + onr;
      const { data: byAlt } = await baseQuery()
        .eq("order_nummer", alt)
        .maybeSingle();
      if (
        byAlt?.id &&
        isDatumOpmerkingVandaagOfMorgen(byAlt.datum_opmerking) &&
        !(mpPaused && isIncompleteMpOrder(byAlt))
      ) {
        orderId = byAlt.id;
      }
    }
    if (!orderId) {
      results.push(
        `Order ${onr}: niet gevonden (of voldoet niet: datum vandaag/morgen + meenemen = ja)`
      );
      continue;
    }

    const { error } = await supabase
      .from("orders")
      .update({ aankomsttijd_slot: clearSlot ? null : slotRaw })
      .eq("owner_email", ownerEmail)
      .eq("id", orderId);

    if (error) {
      results.push(`Order ${onr}: fout (${error.message})`);
    } else {
      results.push(
        clearSlot
          ? `Order ${onr}: tijdslot verwijderd`
          : `Order ${onr}: tijdslot gezet op ${slotRaw}`
      );
      slotsUpdated = true;
    }
  }

  return {
    content: JSON.stringify(
      results.length > 0
        ? { result: results.join(". ") }
        : { error: "Geen geldige updates." }
    ),
    slotsUpdated,
  };
}

async function handleStuurFactuur(
  supabase: Db,
  ownerEmail: string,
  rawArgs: string
): Promise<{ content: string; invoiceSent: boolean }> {
  if (!mayCreateMoneybirdInvoicesForOwner(ownerEmail)) {
    return {
      content: JSON.stringify({
        error: "Dit account mag geen Moneybird-facturen versturen.",
      }),
      invoiceSent: false,
    };
  }
  if (!isMoneybirdConfigured()) {
    return {
      content: JSON.stringify({ error: "Moneybird niet geconfigureerd." }),
      invoiceSent: false,
    };
  }

  let args: { order_nummer?: string; order_id?: string; email?: string };
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return {
      content: JSON.stringify({ error: "Ongeldige parameters." }),
      invoiceSent: false,
    };
  }

  const orderIdRaw = String(args.order_id ?? "").trim();
  const onr = String(args.order_nummer ?? "").trim();
  const emailOverride = String(args.email ?? "").trim() || null;

  let order: {
    id: string;
    order_nummer: string | null;
    email: string | null;
    moneybird_invoice_id: string | null;
    source: string | null;
    type: string | null;
  } | null = null;

  if (orderIdRaw) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_nummer, email, moneybird_invoice_id, source, type"
      )
      .eq("owner_email", ownerEmail)
      .eq("id", orderIdRaw)
      .maybeSingle();
    order = data;
  } else if (onr) {
    const alt = onr.startsWith("#") ? onr.slice(1) : `#${onr}`;
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_nummer, email, moneybird_invoice_id, source, type"
      )
      .eq("owner_email", ownerEmail)
      .or(`order_nummer.eq.${onr},order_nummer.eq.${alt}`)
      .limit(1)
      .maybeSingle();
    order = data;
  }

  if (!order?.id) {
    return {
      content: JSON.stringify({ error: "Order niet gevonden." }),
      invoiceSent: false,
    };
  }

  const invoiceId = String(order.moneybird_invoice_id ?? "").trim();
  if (!invoiceId) {
    return {
      content: JSON.stringify({
        error:
          "Deze order heeft nog geen Moneybird-factuur-id. Maak/verstuur eerst via de normale flow.",
      }),
      invoiceSent: false,
    };
  }

  const isReparatie =
    String(order.source ?? "").toLowerCase() === "reparatie" ||
    String(order.type ?? "").startsWith("reparatie_");

  try {
    if (isReparatie) {
      const sendRes = await sendReparatieSalesInvoice({
        orderId: order.id,
        invoiceId,
        email: emailOverride || order.email,
      });
      if (sendRes.sent) {
        return {
          content: JSON.stringify({
            ok: true,
            order_nummer: order.order_nummer,
            invoiceId: sendRes.invoiceId ?? invoiceId,
            message: "Factuur verzonden per e-mail.",
          }),
          invoiceSent: true,
        };
      }
      return {
        content: JSON.stringify({
          ok: false,
          skipped: sendRes.skipped,
          error: sendRes.error,
          invoiceId: sendRes.invoiceId ?? invoiceId,
        }),
        invoiceSent: false,
      };
    }

    const full = await fetchSalesInvoiceById(invoiceId);
    if (!full?.id) {
      return {
        content: JSON.stringify({ error: "Factuur niet gevonden in Moneybird." }),
        invoiceSent: false,
      };
    }
    if (!isDraftMoneybirdInvoice(full)) {
      return {
        content: JSON.stringify({
          ok: false,
          skipped: `state_${String(full.state ?? "unknown").toLowerCase()}`,
          message: "Factuur is geen concept meer — niet opnieuw gemaild.",
          invoiceId: full.id,
        }),
        invoiceSent: false,
      };
    }
    const sent = await sendSalesInvoiceByEmail(full.id, {
      emailAddress: emailOverride || order.email,
    });
    return {
      content: JSON.stringify({
        ok: true,
        order_nummer: order.order_nummer,
        invoiceId: sent.id ?? full.id,
        message: "Factuur verzonden per e-mail.",
      }),
      invoiceSent: true,
    };
  } catch (e) {
    return {
      content: JSON.stringify({
        error: e instanceof Error ? e.message : "Versturen mislukt.",
      }),
      invoiceSent: false,
    };
  }
}

/**
 * POST /api/planning-agent
 * Body: { messages, pathname?, ritjesContext?: { orders, routeVertrektijden } }
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY niet geconfigureerd." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const messages = body.messages as
      | Array<{ role: string; content: string }>
      | undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is verplicht." },
        { status: 400 }
      );
    }

    const pathname = String(body.pathname ?? "").trim() || "/";
    const ritjesOrders = (body.ritjesContext?.orders ?? []) as RitjesOrder[];
    const routeVertrektijden = (
      body.ritjesContext as { routeVertrektijden?: string } | undefined
    )?.routeVertrektijden;

    const systemPrompt = buildPlanningAgentSystemPrompt({
      pathname,
      contextBlock: buildContextBlock(ritjesOrders),
      routeVertrektijdenContext: routeVertrektijden,
    });

    const openai = new OpenAI({ apiKey });
    const tools = toolDefs();

    let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      ];

    let slotsUpdated = false;
    let invoiceSent = false;
    let lastContent = "";
    let maxRounds = 6;

    while (maxRounds-- > 0) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: currentMessages,
        tools,
        tool_choice: "auto",
        max_tokens: 1400,
      });

      const msg = completion.choices[0]?.message;
      if (!msg) break;
      lastContent = msg.content ?? "";

      if (!msg.tool_calls?.length) break;

      let supabase: Db;
      try {
        supabase = createServerSupabaseClient();
      } catch {
        currentMessages = [
          ...currentMessages,
          msg,
          {
            role: "tool",
            tool_call_id: msg.tool_calls[0]!.id,
            content: JSON.stringify({ error: "Supabase niet geconfigureerd." }),
          },
        ];
        continue;
      }

      const mpPaused = await isMpPausedForOwner(supabase, ownerEmail);
      const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        [];

      for (const tc of msg.tool_calls) {
        const parsed = fnArgs(tc);
        if (!parsed) continue;

        console.info("[planning-agent] tool", parsed.name, ownerEmail);

        if (parsed.name === "zoek_app_kennis") {
          let query = "";
          try {
            query = String(JSON.parse(parsed.arguments).query ?? "");
          } catch {
            query = "";
          }
          const blokken = zoekAppKennis(query);
          toolResults.push({
            role: "tool",
            tool_call_id: parsed.id,
            content: formatKennisVoorTool(blokken),
          });
          continue;
        }

        if (parsed.name === "raadpleeg_moneybird_api") {
          let vraag = "";
          let docsUrl: string | undefined;
          try {
            const a = JSON.parse(parsed.arguments) as {
              vraag?: string;
              docs_url?: string;
            };
            vraag = String(a.vraag ?? "");
            docsUrl = a.docs_url;
          } catch {
            /* ignore */
          }
          const text = await raadpleegMoneybirdApi({
            vraag,
            docsUrl,
          });
          toolResults.push({
            role: "tool",
            tool_call_id: parsed.id,
            content: text,
          });
          continue;
        }

        if (parsed.name === "zoek_orders") {
          const content = await handleZoekOrders(
            supabase,
            ownerEmail,
            parsed.arguments
          );
          toolResults.push({
            role: "tool",
            tool_call_id: parsed.id,
            content,
          });
          continue;
        }

        if (parsed.name === "set_aankomsttijd_slots") {
          const r = await handleSetSlots(
            supabase,
            ownerEmail,
            parsed.arguments,
            mpPaused
          );
          if (r.slotsUpdated) slotsUpdated = true;
          toolResults.push({
            role: "tool",
            tool_call_id: parsed.id,
            content: r.content,
          });
          continue;
        }

        if (parsed.name === "stuur_moneybird_factuur") {
          const r = await handleStuurFactuur(
            supabase,
            ownerEmail,
            parsed.arguments
          );
          if (r.invoiceSent) invoiceSent = true;
          toolResults.push({
            role: "tool",
            tool_call_id: parsed.id,
            content: r.content,
          });
          continue;
        }

        toolResults.push({
          role: "tool",
          tool_call_id: parsed.id,
          content: JSON.stringify({ error: `Onbekende tool: ${parsed.name}` }),
        });
      }

      currentMessages = [...currentMessages, msg, ...toolResults];
    }

    return NextResponse.json({
      content: lastContent,
      role: "assistant",
      slotsUpdated,
      invoiceSent,
    });
  } catch (e) {
    console.error("[api/planning-agent]", e);
    const message = e instanceof Error ? e.message : "Chat mislukt.";
    const status = /niet ingelogd|unauthorized|401/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
