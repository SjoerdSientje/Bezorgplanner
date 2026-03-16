import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verwerkGarantiebewijs, type GarantieData } from "@/lib/garantiebewijs";

/**
 * GET /api/test-garantie
 * Test de garantiebewijs-flow: PDF genereren, upload Supabase, email met bijlage.
 * Open in browser: http://localhost:3000/api/test-garantie
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase niet geconfigureerd." },
      { status: 500 }
    );
  }

  const testData: GarantieData = {
    order_id: "test-" + Date.now(),
    order_nummer: "#MPATEST",
    naam: "Test Klant",
    email: process.env.GMAIL_FROM ?? "test@test.nl",
    producten: "V20 PRO Fatbike 2026",
    serienummer: "TEST123",
    totaal_prijs: 850,
    aantal_fietsen: 1,
    datum: new Date().toLocaleDateString("nl-NL"),
  };

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const link = await verwerkGarantiebewijs(testData, supabase);
    return NextResponse.json({
      ok: true,
      link,
      summary: "PDF aangemaakt, geüpload en email verstuurd (met bijlage).",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg, summary: "Fout bij garantiebewijs." },
      { status: 500 }
    );
  }
}
