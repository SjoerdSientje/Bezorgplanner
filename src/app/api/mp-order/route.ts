import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verwerkGarantiebewijs } from "@/lib/garantiebewijs";

/**
 * POST /api/mp-order
 * Slaat een nieuwe Marktplaats order op in Supabase.
 * - Bezorging → status 'ritjes_vandaag', type 'verkoop'
 * - Afhaal → status 'mp_orders', type 'mp_winkel';
 *   maakt direct een garantiebewijs via Google Docs en stuurt het via Gmail.
 */
export async function POST(request: NextRequest) {
  console.log("[api/mp-order] POST ontvangen", new Date().toISOString());
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      console.error("[api/mp-order] Supabase env vars ontbreken");
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    console.log("[api/mp-order] soort:", body.soort, "naam:", body.naam);
    const soort = body.soort as "bezorging" | "afhaal";

    const straat = (body.straatnaam ?? "").trim();
    const huisnummer = (body.huisnummer ?? "").trim();
    const postcode = (body.postcode ?? "").trim();
    const woonplaats = (body.woonplaats ?? "").trim();
    const volledigAdres = [straat, huisnummer, postcode, woonplaats].filter(Boolean).join(", ");

    const telefoonRaw = (body.telefoonnummer ?? "").trim();
    const e164 = telefoonRaw.startsWith("+")
      ? telefoonRaw
      : telefoonRaw.startsWith("0")
      ? "+31" + telefoonRaw.slice(1)
      : telefoonRaw;

    const mapsUrl = volledigAdres
      ? `https://maps.google.com/maps?q=${encodeURIComponent(volledigAdres)}`
      : null;
    const naam = (body.naam ?? "").trim();
    const belLink = e164
      ? `https://call.ctrlq.org/${e164}`
      : null;

    // Datum (Amsterdam timezone)
    const nu = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
    const dd = String(nu.getDate()).padStart(2, "0");
    const mm = String(nu.getMonth() + 1).padStart(2, "0");
    const yyyy = nu.getFullYear();
    const datumDb = `${yyyy}-${mm}-${dd}`;

    // Extraheer fietsmodel: 'V20 PRO Fatbike 2026 + ringslot | Combi-Deal 🔥' → 'V20 PRO'
    function extractModel(producten: string | null): string | null {
      if (!producten) return null;
      const match = producten.match(/^(.+?)\s+fatbike/i);
      if (match) return match[1].trim();
      return producten.split(/[|,]/)[0].trim() || null;
    }

    // Genereer ordernummer
    const supabaseTemp = createClient(supabaseUrl, serviceKey);
    let orderNummer: string | null = null;
    if (soort === "afhaal") {
      const { data: laatste } = await supabaseTemp
        .from("orders").select("order_nummer")
        .like("order_nummer", "#MPA%")
        .order("order_nummer", { ascending: false }).limit(1).maybeSingle();
      const prev = laatste?.order_nummer ? parseInt(laatste.order_nummer.replace("#MPA", ""), 10) : 999;
      orderNummer = `#MPA${isNaN(prev) ? 1000 : prev + 1}`;
    } else {
      const { data: laatste } = await supabaseTemp
        .from("orders").select("order_nummer")
        .like("order_nummer", "#MPB%")
        .order("order_nummer", { ascending: false }).limit(1).maybeSingle();
      const prev = laatste?.order_nummer ? parseInt(laatste.order_nummer.replace("#MPB", ""), 10) : 1024;
      orderNummer = `#MPB${isNaN(prev) ? 1025 : prev + 1}`;
    }

    const totaalPrijs = body.totaal_prijs ? parseFloat(String(body.totaal_prijs)) : null;
    const producten = (body.producten ?? "").trim() || null;

    // Accessoires + montage samenvoegen in producten voor bezorging
    const accRaw = (body.accessoires ?? "").trim();
    const monRaw = (body.montage ?? "").trim();
    const accVal = accRaw && accRaw.toLowerCase() !== "x" ? accRaw : null;
    const monVal = monRaw && monRaw.toLowerCase() !== "x" ? monRaw : null;
    const extraParts = [
      accVal ? `Accessoires: ${accVal}` : null,
      monVal ? `Montage: ${monVal}` : null,
    ].filter(Boolean);
    const productenBezorging = producten
      ? (extraParts.length ? `${producten} | ${extraParts.join(" | ")}` : producten)
      : (extraParts.join(" | ") || null);

    const insert = {
      source: "mp" as const,
      type: soort === "afhaal" ? ("mp_winkel" as const) : ("verkoop" as const),
      status: soort === "afhaal" ? ("mp_orders" as const) : ("ritjes_vandaag" as const),
      order_nummer: orderNummer,
      naam: naam || null,
      volledig_adres: volledigAdres || null,
      adres_url: mapsUrl,
      telefoon_nummer: telefoonRaw || null,
      telefoon_e164: e164 || null,
      bel_link: belLink,
      email: (body.email ?? "").trim() || null,
      producten: soort === "bezorging" ? productenBezorging : producten,
      bestelling_totaal_prijs: totaalPrijs,
      aantal_fietsen: body.aantal_fietsen ? parseInt(String(body.aantal_fietsen), 10) : null,
      serienummer: soort === "afhaal" ? ((body.serienummer ?? "").trim() || null) : null,
      model: soort === "bezorging" ? extractModel(producten) : null,
      datum: datumDb,
      meenemen_in_planning: soort === "bezorging" ? true : false,

      // Bezorging defaults
      ...(soort === "bezorging" && {
        nieuw_appje_sturen: true,
        betaalmethode: "contant aan deur",
        mp_tags: "MP",
        bezorgtijd_voorkeur: ((body.bezorgtijd_voorkeur ?? "").trim().toLowerCase() === "x")
          ? "geen"
          : (body.bezorgtijd_voorkeur ?? "").trim() || null,
        datum_opmerking: ((body.datum_voorkeur ?? "").trim().toLowerCase() === "x")
          ? "vandaag"
          : (body.datum_voorkeur ?? "").trim() || null,
        opmerkingen_klant: ((body.opmerking ?? "").trim().toLowerCase() === "x")
          ? "geen opmerking"
          : (body.opmerking ?? "").trim() || null,
      }),

      // Afhaal defaults
      ...(soort === "afhaal" && {
        bezorger_naam: "winkelverkoop",
        betaalmethode: "contant in winkel",
        betaald_bedrag: totaalPrijs,
        opmerkingen_klant: ((body.opmerking ?? "").trim().toLowerCase() === "x")
          ? "geen opmerking"
          : (body.opmerking ?? "").trim() || null,
      }),
    };

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase
      .from("orders")
      .insert(insert)
      .select("id, order_nummer")
      .single();

    if (error) {
      console.error("[api/mp-order] INSERT fout:", error.message, error.details, error.hint);
      return NextResponse.json(
        { error: "Opslaan mislukt.", detail: error.message },
        { status: 500 }
      );
    }
    console.log("[api/mp-order] INSERT gelukt, id:", data.id, "order_nummer:", data.order_nummer);

    // Bij afhaal-order: PDF garantiebewijs genereren, opslaan in Supabase Storage, email met bijlage.
    let garantieError: string | null = null;
    if (soort === "afhaal") {
      try {
        const garantieLink = await verwerkGarantiebewijs(
          {
            order_id: data.id,
            order_nummer: data.order_nummer ?? null,
            naam: insert.naam,
            email: insert.email,
            producten: insert.producten,
            serienummer: insert.serienummer,
            totaal_prijs: insert.bestelling_totaal_prijs,
            aantal_fietsen: insert.aantal_fietsen,
            datum: new Date().toLocaleDateString("nl-NL"),
          },
          supabase
        );

        await supabase
          .from("orders")
          .update({ link_aankoopbewijs: garantieLink })
          .eq("id", data.id);
      } catch (garantieErr) {
        const msg = garantieErr instanceof Error ? garantieErr.message : String(garantieErr);
        console.error("[api/mp-order] Garantiebewijs fout:", msg, garantieErr);
        garantieError = msg;
      }
    }

    const message =
      soort === "afhaal"
        ? garantieError
          ? "Order opgeslagen in MP orders. Garantiebewijs/email kon niet worden verzonden (zie waarschuwing)."
          : "Order opgeslagen in MP orders. Garantiebewijs aangemaakt en verstuurd naar klant."
        : "Order opgeslagen in Ritjes voor vandaag.";

    return NextResponse.json({
      ok: true,
      id: data.id,
      order_nummer: data.order_nummer,
      message,
      garantieError: garantieError ?? undefined,
    });
  } catch (e) {
    console.error("[api/mp-order]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
