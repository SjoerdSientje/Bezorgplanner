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
      .select("id, source, mp_tags, order_nummer, naam, aankomsttijd_slot, bestelling_totaal_prijs, telefoon_e164, telefoon_nummer, type, betaald, datum, opmerkingen_klant, bezorgtijd_voorkeur, email, producten, serienummer, aantal_fietsen, link_aankoopbewijs")
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

    const toMpOrders = isMpTagged(order.mp_tags);
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

    // Update order afrond-info + status
    const updatePayload: Record<string, unknown> = {
      bezorger_naam: bezorgerNaam,
      betaalmethode,
      afgerond_at: new Date().toISOString(),
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
        datum: (order as any).datum,
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

