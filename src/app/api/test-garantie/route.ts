import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verwerkGarantiebewijs, type GarantieData } from "@/lib/garantiebewijs";

/** Voorkomt statische prerender / cache; elke hit moet expliciet zijn. */
export const dynamic = "force-dynamic";

/**
 * GET /api/test-garantie
 * Test de garantiebewijs-flow: PDF genereren, upload Supabase, optioneel e-mail.
 *
 * Lokale dev (`next dev`): zonder extra geheim.
 * Productie / `next start`: zet TEST_GARANTIE_SECRET en roep aan met ?key=...
 *
 * Stuur geen testmail naar GMAIL_FROM — dat spamde het service-inbox. Zet
 * TEST_GARANTIE_EMAIL als je echt een testmail wilt; anders alleen PDF-upload.
 */
export async function GET(request: NextRequest) {
  const isLocalDev = process.env.NODE_ENV === "development";
  const secret = process.env.TEST_GARANTIE_SECRET;
  if (!isLocalDev) {
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "Test endpoint uitgeschakeld (TEST_GARANTIE_SECRET ontbreekt)." },
        { status: 403 }
      );
    }
    const key = request.nextUrl.searchParams.get("key");
    if (key !== secret) {
      return NextResponse.json({ ok: false, error: "Niet toegestaan." }, { status: 403 });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase niet geconfigureerd." },
      { status: 500 }
    );
  }

  const testEmail = process.env.TEST_GARANTIE_EMAIL?.trim() || null;
  const skipEmail = !testEmail;

  const testData: GarantieData = {
    order_id: "test-" + Date.now(),
    order_nummer: "#MPATEST",
    naam: "Test Klant",
    email: testEmail,
    producten: "V20 PRO Fatbike 2026",
    serienummer: "TEST123",
    totaal_prijs: 850,
    aantal_fietsen: 1,
    datum: new Date().toLocaleDateString("nl-NL"),
  };

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const link = await verwerkGarantiebewijs(testData, supabase, { skipEmail });
    return NextResponse.json({
      ok: true,
      link,
      emailSent: !skipEmail,
      summary: skipEmail
        ? "PDF aangemaakt en geüpload; geen e-mail (zet TEST_GARANTIE_EMAIL om te mailen)."
        : "PDF aangemaakt, geüpload en e-mail verstuurd naar TEST_GARANTIE_EMAIL.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg, summary: "Fout bij garantiebewijs." },
      { status: 500 }
    );
  }
}
