import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { sendWhatsAppByEvent } from "@/lib/whatsapp";
import { requireAccountEmail } from "@/lib/account";
import { verwerkGarantiebewijs } from "@/lib/garantiebewijs";
import { promoteRitjesVoorMorgen } from "@/lib/planning-promote";

export const dynamic = "force-dynamic";

const PAYMENT_OPTIONS = new Set([
  "Was al betaald",
  "Factuur betaling aan deur",
  "Contant aan deur",
  "Anders",
]);
const MAKE_AFRONDEN_WEBHOOK_URL =
  "https://hook.eu2.make.com/vuvbe7u93yr2lbg8augxh23gu7u22sgd";
const MAKE_AFRONDEN_OWNER_EMAIL = "info@koopjefatbike.nl";

function isMpTagged(mpTags: unknown): boolean {
  const t = String(mpTags ?? "").toLowerCase();
  // Match zowel "MP" als "mp" als losse tag of onderdeel van comma/space-separated tekst
  return /\bmp\b/.test(t);
}

function isMpOrderNummer(orderNummer: unknown): boolean {
  return /^#mp/i.test(String(orderNummer ?? "").trim());
}

export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));
    const orderId = String(body.orderId ?? "").trim();
    const bezorgerNaam = String(body.bezorger_naam ?? "").trim();
    const betaalOptie = String(body.betaal_optie ?? "").trim();
    const betaalAnders = String(body.betaal_anders ?? "").trim();
    const betaalBedragRaw = body.betaal_bedrag;
    const betaalBedragNum =
      betaalBedragRaw === undefined || betaalBedragRaw === null || String(betaalBedragRaw).trim() === ""
        ? null
        : parseFloat(String(betaalBedragRaw).replace(",", "."));
    const serienummerInput = String(body.serienummer ?? "").trim();
    const reparatieRegels = Array.isArray(body.reparatie_regels)
      ? body.reparatie_regels
      : null;

    if (!orderId) {
      return NextResponse.json({ error: "Order-id ontbreekt." }, { status: 400 });
    }
    if (!bezorgerNaam) {
      return NextResponse.json({ error: "Naam bezorger ontbreekt." }, { status: 400 });
    }
    if (!PAYMENT_OPTIONS.has(betaalOptie)) {
      return NextResponse.json({ error: "Ongeldige betaaloptie." }, { status: 400 });
    }
    const betaalmethode =
      betaalOptie === "Anders" ? (betaalAnders || "Anders") : betaalOptie;
    const needsBedrag =
      betaalOptie === "Factuur betaling aan deur" || betaalOptie === "Contant aan deur";
    if (needsBedrag) {
      if (betaalBedragNum == null || Number.isNaN(betaalBedragNum) || betaalBedragNum < 0) {
        return NextResponse.json({ error: "Bedrag ontbreekt of ongeldig." }, { status: 400 });
      }
    }

    const supabase = createServerSupabaseClient();

    // Haal order op om MP-tag te bepalen
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("*")
      .eq("owner_email", ownerEmail)
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) {
      console.error("[api/afronden] order", orderErr);
      return NextResponse.json({ error: "Order ophalen mislukt." }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "Order niet gevonden." }, { status: 404 });
    }

    // Reparatie aan huis met onbekende producten: verplicht invullen vóór afronden.
    if (
      order.type === "reparatie_deur" &&
      Boolean(order.producten_nog_niet_bekend)
    ) {
      if (!reparatieRegels?.length) {
        return NextResponse.json(
          {
            error:
              "Vul eerst de gebruikte producten en arbeidsuren in (producten waren nog niet bekend).",
          },
          { status: 400 }
        );
      }
      const {
        buildReparatieShopifyLineItems,
        buildReparatieLineItemsJson,
        productenTekstFromLineItems,
        sumLineItemsIncl,
      } = await import("@/lib/reparaties");
      const { upsertReparatieSalesInvoice } = await import("@/lib/moneybird");

      const expanded = reparatieRegels.map((r: Record<string, unknown>) => ({
        kind: "custom" as const,
        naam: String(r.naam ?? r.onderdeel_naam ?? "Reparatie"),
        onderdeel_naam: String(r.onderdeel_naam ?? r.naam ?? ""),
        onderdeel_prijs_incl: Number(r.onderdeel_prijs_incl) || 0,
        shopify_product_id: r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
        shopify_variant_id: r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
        arbeid_uren: Number(r.arbeid_uren) || 0,
      }));
      if (order.voorrij_bedrag != null && Number(order.voorrij_bedrag) >= 0.01) {
        expanded.push({
          kind: "voorrijkosten" as const,
          naam: "Voorrijkosten",
          onderdeel_naam: "",
          onderdeel_prijs_incl: 0,
          shopify_product_id: null,
          shopify_variant_id: null,
          arbeid_uren: 0,
          voorrij_bedrag: Number(order.voorrij_bedrag),
        } as any);
      }

      const lineItems = buildReparatieShopifyLineItems(expanded as any);
      const totaal = sumLineItemsIncl(lineItems);
      const regelsForStore = expanded.filter(
        (r: { kind: string }) => r.kind !== "voorrijkosten"
      );
      await supabase
        .from("orders")
        .update({
          producten: productenTekstFromLineItems(lineItems),
          line_items_json: buildReparatieLineItemsJson(lineItems),
          bestelling_totaal_prijs: Math.round(totaal * 100) / 100,
          producten_nog_niet_bekend: false,
          reparatie_regels_json: regelsForStore,
        })
        .eq("id", orderId)
        .eq("owner_email", ownerEmail);

      if (order.reparatie_betaalwijze === "factuur") {
        try {
          const inv = await upsertReparatieSalesInvoice({
            orderId,
            orderNummer: String(order.order_nummer ?? orderId),
            existingInvoiceId: order.moneybird_invoice_id,
            contact: {
              email: String(order.email ?? "onbekend@koopjefatbike.nl"),
              lastname: String(order.naam ?? "Klant"),
              phone: String(order.telefoon_e164 ?? order.telefoon_nummer ?? ""),
              address1: String(order.volledig_adres ?? ""),
            },
            lines: lineItems
              .filter((li) => String(li.name).toLowerCase() !== "producten nog niet bekend")
              .map((li) => ({
                description: String(li.name ?? ""),
                priceIncl:
                  typeof li.price === "number"
                    ? li.price
                    : parseFloat(String(li.price ?? 0)) || 0,
                quantity: Math.max(1, Math.floor(Number(li.quantity ?? 1))),
              })),
          });
          if (inv?.id) {
            await supabase
              .from("orders")
              .update({ moneybird_invoice_id: inv.id })
              .eq("id", orderId);
          }
        } catch (mbErr) {
          console.error("[api/afronden] reparatie moneybird:", mbErr);
        }
      }
    }

    const toMpOrders =
      isMpTagged(order.mp_tags) ||
      String((order as any).source ?? "").toLowerCase() === "mp" ||
      isMpOrderNummer((order as any).order_nummer);
    const nextStatus = toMpOrders ? "mp_orders" : "bezorgd";

    // MP-orders: verstuur aankoopbewijs na afronden met het opgegeven serienummer.
    let aankoopbewijsError: string | null = null;
    if (toMpOrders && serienummerInput) {
      const inDoos = /^in\s*doos$/i.test(serienummerInput);
      const serienummerVoorOrder = inDoos ? serienummerInput : serienummerInput;
      try {
        const link = await verwerkGarantiebewijs(
          {
            order_id: String((order as any).id),
            order_nummer: (order as any).order_nummer ?? null,
            naam: (order as any).naam ?? null,
            email: (order as any).email ?? null,
            producten: (order as any).producten ?? null,
            model: (order as any).model ?? null,
            serienummer: inDoos ? null : serienummerInput,
            totaal_prijs:
              (order as any).bestelling_totaal_prijs != null
                ? Number((order as any).bestelling_totaal_prijs)
                : null,
            aantal_fietsen:
              (order as any).aantal_fietsen != null ? Number((order as any).aantal_fietsen) : null,
            datum: new Date().toLocaleDateString("nl-NL"),
          },
          supabase as any,
          { inDoos }
        );
        (order as any).link_aankoopbewijs = link;
        // Sla serienummer + link op in de order
        await supabase
          .from("orders")
          .update({ serienummer: serienummerVoorOrder, link_aankoopbewijs: link })
          .eq("owner_email", ownerEmail)
          .eq("id", orderId);
      } catch (e) {
        aankoopbewijsError = e instanceof Error ? e.message : String(e);
        console.error("[api/afronden] aankoopbewijs versturen mislukt", e);
      }
    }

    // Huidige datum in Amsterdam-tijd (YYYY-MM-DD) = de werkelijke bezorgdatum
    const bezorgdatum = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

    // Update order afrond-info + status
    const updatePayload: Record<string, unknown> = {
      bezorger_naam: bezorgerNaam,
      betaalmethode,
      afgerond_at: new Date().toISOString(),
      datum: bezorgdatum,
      status: nextStatus,
    };
    if (needsBedrag && betaalBedragNum != null) {
      updatePayload.betaald_bedrag = betaalBedragNum;
    }

    const { error: updErr } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("owner_email", ownerEmail)
      .eq("id", orderId);

    if (updErr) {
      console.error("[api/afronden] update", updErr);
      return NextResponse.json({ error: "Order bijwerken mislukt." }, { status: 500 });
    }

    // MP-bezorg: reservering → echte voorraadaftrek bij afronden.
    if (toMpOrders) {
      try {
        const { commitInventoryForMpOrder } = await import("@/lib/inventory-reservations");
        await commitInventoryForMpOrder(
          supabase,
          ownerEmail,
          orderId,
          String((order as { order_nummer?: string | null }).order_nummer ?? orderId)
        );
      } catch (invErr) {
        console.error("[api/afronden] inventory commit:", invErr);
      }
    }

    // Controleer hoeveel slots er zijn vóór delete (voor debuggen).
    const { data: slotsVoor, error: checkErr } = await supabase
      .from("planning_slots")
      .select("id, order_id, datum, aankomsttijd")
      .eq("owner_email", ownerEmail)
      .eq("order_id", orderId);
    console.log("[api/afronden] slots VOOR delete:", JSON.stringify(slotsVoor), "orderId:", orderId, "checkErr:", checkErr?.message);

    // Verwijder alle planning_slots voor deze order.
    const { error: delErr } = await supabase
      .from("planning_slots")
      .delete()
      .eq("owner_email", ownerEmail)
      .eq("order_id", orderId);
    console.log("[api/afronden] delete result - error:", delErr?.message ?? "geen");

    // Verifieer dat ze echt weg zijn.
    const { data: slotsNa } = await supabase
      .from("planning_slots")
      .select("id")
      .eq("owner_email", ownerEmail)
      .eq("order_id", orderId);
    console.log("[api/afronden] slots NA delete:", slotsNa?.length ?? 0, "rijen voor orderId:", orderId);

    if (delErr) {
      console.error("[api/afronden] delete planning_slots fout:", delErr);
    }

    // Als planning nu leeg is, promoot ritjes voor morgen naar vandaag.
    await promoteRitjesVoorMorgen(ownerEmail, supabase as any);

    const slotDatums = (slotsVoor ?? [])
      .map((s: { datum?: string | null }) => String(s.datum ?? "").trim())
      .filter(Boolean)
      .sort();
    const templateBezorgdatum =
      slotDatums.length > 0 ? slotDatums[slotDatums.length - 1]! : String((order as any).datum ?? "").trim();

    const waRes = await sendWhatsAppByEvent(
      "afronden",
      {
        order_nummer: (order as any).order_nummer,
        naam: (order as any).naam,
        aankomsttijd_slot: (order as any).aankomsttijd_slot,
        bestelling_totaal_prijs: (order as any).bestelling_totaal_prijs,
        telefoon_e164: (order as any).telefoon_e164,
        telefoon_nummer: (order as any).telefoon_nummer,
        type: (order as any).type,
        betaald: (order as any).betaald,
        mp_tags: (order as any).mp_tags,
        datum: templateBezorgdatum,
        opmerkingen_klant: (order as any).opmerkingen_klant,
        bezorgtijd_voorkeur: (order as any).bezorgtijd_voorkeur,
      },
      { ownerEmail }
    );

    // Make-webhook: alleen voor shopify orders (ordernummer zonder #MP) die uit planning komen.
    const hadPlanningSlot = (slotsVoor?.length ?? 0) > 0;
    const orderNummer = String((order as any).order_nummer ?? "").trim();
    if (
      ownerEmail.toLowerCase() === MAKE_AFRONDEN_OWNER_EMAIL &&
      hadPlanningSlot &&
      orderNummer &&
      !isMpOrderNummer(orderNummer)
    ) {
      try {
        await fetch(MAKE_AFRONDEN_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ordernummer: orderNummer,
            order_nummer: orderNummer,
          }),
        });
      } catch (webhookErr) {
        console.error("[api/afronden] make webhook fout:", webhookErr);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        nextStatus,
        aankoopbewijsError,
        debug: {
          orderId,
          slotsVoorDelete: slotsVoor?.length ?? 0,
          slotsNaDelete: slotsNa?.length ?? 0,
          deleteError: delErr?.message ?? null,
        },
        whatsapp: waRes,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/afronden]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

