import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  calcVoorrijkostenForAddress,
  loadVoorrijkostenSettings,
  upsertVoorrijkostenSettings,
} from "@/lib/reparaties";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const settings = await loadVoorrijkostenSettings(supabase, ownerEmail);
    return NextResponse.json({ settings });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ophalen mislukt.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json();
    const supabase = createServerSupabaseClient();
    const settings = await upsertVoorrijkostenSettings(supabase, ownerEmail, {
      basis_eur: body.basis_eur != null ? Number(body.basis_eur) : undefined,
      per_km_eur: body.per_km_eur != null ? Number(body.per_km_eur) : undefined,
      afronding_eur:
        body.afronding_eur != null ? Number(body.afronding_eur) : undefined,
    });
    return NextResponse.json({ settings });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Opslaan mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** POST { adres } → { km, bedrag, raw, settings } */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json();
    const adres = String(body.adres ?? "").trim();
    if (adres.length < 5) {
      return NextResponse.json({ error: "Adres verplicht." }, { status: 400 });
    }
    const supabase = createServerSupabaseClient();
    const result = await calcVoorrijkostenForAddress(supabase, ownerEmail, adres);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Berekening mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
