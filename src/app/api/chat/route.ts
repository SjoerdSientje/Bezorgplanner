import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { requireAccountEmail } from "@/lib/account";
import { buildSientjeSystemPrompt } from "@/lib/sientje-system-prompt";

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

function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * Alleen orders met datum_opmerking = "vandaag" (of de datum van vandaag)
 * én meenemen_in_planning = true mogen gezien/bewerkt worden door Sientje.
 */
function isEligibleOrder(o: RitjesOrder): boolean {
  if (!o.meenemen_in_planning) return false;
  const datum = String(o.datum_opmerking ?? "").toLowerCase().trim();
  if (!datum) return false;
  return datum === "vandaag" || datum === todayDDMMYYYY();
}

function formatOrderForContext(o: RitjesOrder): string {
  const slot = o.aankomsttijd_slot?.trim() ?? "";
  const slotStr = slot ? slot : "(nog geen slot)";
  return `Order ${o.order_nummer ?? "?"} | ${o.naam ?? ""} | Adres: ${o.volledig_adres ?? ""} | Aankomsttijd (tijdslot): ${slotStr} | Bezorgtijd voorkeur (tijdsvenster/restrictie): ${o.bezorgtijd_voorkeur ?? "-"} | Datum opmerking: ${o.datum_opmerking ?? "-"} | Aantal fietsen: ${o.aantal_fietsen ?? ""}`;
}

function buildContextBlock(ritjesOrders: RitjesOrder[]): string {
  // Sientje ziet alleen orders die voor vandaag én op "ja" staan
  const eligible = ritjesOrders.filter(isEligibleOrder);

  if (eligible.length === 0) {
    return "\n\nEr zijn momenteel geen orders die aan de criteria voldoen (datum = vandaag én meenemen in planning = ja).";
  }
  const withSlot = eligible.filter((o) => (o.aankomsttijd_slot ?? "").trim().length > 0);
  const withoutSlot = eligible.filter((o) => !(o.aankomsttijd_slot ?? "").trim().length);
  let block =
    "\n\nOrders die jij mag bekijken en bewerken (datum = vandaag, meenemen in planning = ja):\n" +
    eligible.map(formatOrderForContext).join("\n");
  if (withSlot.length > 0) {
    block +=
      "\n\n**Belangrijk:** De rijen die al een tijdslot (Aankomsttijd) hebben, vormen samen de huidige geplande route. Orders zonder tijdslot staan wel in de lijst maar zitten nog niet in de route.";
  }
  if (withoutSlot.length > 0 && withSlot.length > 0) {
    block += ` Momenteel hebben ${withSlot.length} order(s) een slot (de route) en ${withoutSlot.length} order(s) nog geen slot.`;
  }
  block +=
    "\n\nRoep **set_aankomsttijd_slots** alleen aan na **expliciete bevestiging** van de gebruiker. Je kunt tijdsloten **zetten**, **wijzigen** of **wissen** (lege string of 'verwijder' per order). Match op order_nummer. Alleen orders die aan de criteria voldoen.";
  return block;
}

/**
 * POST /api/chat
 * Body: { messages, ritjesContext?: { orders } }
 * Sparren met Sientje: leest Ritjes voor vandaag, kan tijdsloten doorvoeren via tool.
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
    const messages = body.messages as Array<{ role: string; content: string }> | undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is verplicht." },
        { status: 400 }
      );
    }

    const ritjesOrders = (body.ritjesContext?.orders ?? []) as RitjesOrder[];
    const vertrektijd = (body.ritjesContext as { vertrektijd?: string } | undefined)?.vertrektijd;
    const contextBlock = buildContextBlock(ritjesOrders);
    const systemPrompt = buildSientjeSystemPrompt(contextBlock, vertrektijd);

    const openai = new OpenAI({ apiKey });

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "set_aankomsttijd_slots",
          description:
            "Zet, wijzig of wis het klanttijdslot (kolom Aankomsttijd) voor één of meer orders. Zetten: 'HH:MM - HH:MM'. Wissen: lege string of 'verwijder'. Alleen na expliciete bevestiging van de gebruiker. Match op order_nummer.",
          parameters: {
            type: "object",
            properties: {
              updates: {
                type: "array",
                description: "Lijst van order_nummer met tijdslot of leeg om te wissen",
                items: {
                  type: "object",
                  properties: {
                    order_nummer: {
                      type: "string",
                      description: "Order nummer zoals in de tabel (bijv. #1001)",
                    },
                    aankomsttijd_slot: {
                      type: "string",
                      description:
                        "Tijdslot als HH:MM - HH:MM. Lege string of 'verwijder' / 'leeg' om het tijdslot van deze order te verwijderen.",
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
    ];

    const allMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    let slotsUpdated = false;
    let lastContent = "";
    let maxRounds = 5;
    let currentMessages = [...allMessages];

    while (maxRounds-- > 0) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: currentMessages,
        tools,
        tool_choice: "auto",
        max_tokens: 1024,
      });

      const choice = completion.choices[0];
      const msg = choice?.message;
      if (!msg) break;

      lastContent = msg.content ?? "";

      if (!msg.tool_calls?.length) {
        break;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !serviceKey) {
        currentMessages = [
          ...currentMessages,
          msg,
          {
            role: "tool" as const,
            tool_call_id: msg.tool_calls[0].id,
            content: JSON.stringify({ error: "Supabase niet geconfigureerd." }),
          },
        ];
        continue;
      }

      const supabase = createClient(supabaseUrl, serviceKey);
      const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      for (const tc of msg.tool_calls) {
        // Nieuwe OpenAI-typen hebben verschillende tool_call-varianten; gebruik een veilige any-cast voor function-calls
        const fn = (tc as any).function;
        if (!fn || fn.name !== "set_aankomsttijd_slots") continue;
        let args: {
          updates?: Array<{ order_nummer: string; aankomsttijd_slot: string }>;
        };
        try {
          args = JSON.parse(fn.arguments ?? "{}");
        } catch {
          toolResults.push({
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify({ error: "Ongeldige parameters." }),
          });
          continue;
        }

        const updates = args.updates ?? [];
        const results: string[] = [];
        const today = todayDDMMYYYY();

        for (const u of updates) {
          const onr = String(u.order_nummer ?? "").trim();
          const slotRaw = String(u.aankomsttijd_slot ?? "").trim();
          const clearSlot =
            slotRaw === "" ||
            /^(verwijder|leeg|wis|clear)$/i.test(slotRaw);
          if (!onr) continue;

          // Zoek de order op — met dubbele beveiliging: status + meenemen_in_planning + datum
          let orderId: string | null = null;
          const baseQuery = supabase
            .from("orders")
            .select("id")
            .eq("owner_email", ownerEmail)
            .eq("status", "ritjes_vandaag")
            .eq("meenemen_in_planning", true)
            .or(`datum_opmerking.eq.vandaag,datum_opmerking.eq.${today}`);

          const { data: byExact } = await baseQuery
            .eq("order_nummer", onr)
            .limit(1)
            .maybeSingle();
          if (byExact?.id) orderId = byExact.id;
          if (!orderId) {
            const alt = onr.startsWith("#") ? onr.slice(1) : "#" + onr;
            const { data: byAlt } = await supabase
              .from("orders")
              .select("id")
              .eq("owner_email", ownerEmail)
              .eq("status", "ritjes_vandaag")
              .eq("meenemen_in_planning", true)
              .or(`datum_opmerking.eq.vandaag,datum_opmerking.eq.${today}`)
              .eq("order_nummer", alt)
              .limit(1)
              .maybeSingle();
            if (byAlt?.id) orderId = byAlt.id;
          }
          if (!orderId) {
            results.push(`Order ${onr}: niet gevonden (of voldoet niet aan de criteria: datum vandaag + meenemen in planning = ja)`);
            continue;
          }

          const valueToStore = clearSlot ? null : slotRaw;

          const { error } = await supabase
            .from("orders")
            .update({ aankomsttijd_slot: valueToStore })
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

        toolResults.push({
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify(
            results.length > 0 ? { result: results.join(". ") } : { error: "Geen geldige updates." }
          ),
        });
      }

      currentMessages = [...currentMessages, msg, ...toolResults];
    }

    return NextResponse.json({
      content: lastContent,
      role: "assistant",
      slotsUpdated,
    });
  } catch (e) {
    console.error("[api/chat]", e);
    const message = e instanceof Error ? e.message : "Er ging iets mis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
