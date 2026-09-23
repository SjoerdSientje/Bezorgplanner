import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  listReparatieStandaardItems,
  type ReparatieStandaardItem,
} from "@/lib/reparaties";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const includeInactive =
      request.nextUrl.searchParams.get("all") === "1";
    const items = await listReparatieStandaardItems(supabase, ownerEmail, {
      includeInactive,
    });
    return NextResponse.json({ items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ophalen mislukt.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json();
    const supabase = createServerSupabaseClient();

    const naam = String(body.naam ?? "").trim();
    if (!naam) {
      return NextResponse.json({ error: "Naam verplicht." }, { status: 400 });
    }

    const payload = {
      owner_email: ownerEmail,
      naam,
      onderdeel_naam: String(body.onderdeel_naam ?? "").trim() || null,
      onderdeel_prijs_incl: Math.max(0, Number(body.onderdeel_prijs_incl) || 0),
      shopify_product_id: body.shopify_product_id
        ? Number(body.shopify_product_id)
        : null,
      shopify_variant_id: body.shopify_variant_id
        ? Number(body.shopify_variant_id)
        : null,
      arbeid_uren: Math.max(0, Number(body.arbeid_uren) || 0),
      sort_order: Number.isFinite(Number(body.sort_order))
        ? Number(body.sort_order)
        : 0,
      active: body.active !== false,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("reparatie_standaard_items")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ item: data as ReparatieStandaardItem });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Opslaan mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id verplicht." }, { status: 400 });
    }
    const supabase = createServerSupabaseClient();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.naam != null) patch.naam = String(body.naam).trim();
    if (body.onderdeel_naam !== undefined) {
      patch.onderdeel_naam = String(body.onderdeel_naam ?? "").trim() || null;
    }
    if (body.onderdeel_prijs_incl != null) {
      patch.onderdeel_prijs_incl = Math.max(0, Number(body.onderdeel_prijs_incl) || 0);
    }
    if (body.arbeid_uren != null) {
      patch.arbeid_uren = Math.max(0, Number(body.arbeid_uren) || 0);
    }
    if (body.sort_order != null) patch.sort_order = Number(body.sort_order) || 0;
    if (body.active != null) patch.active = Boolean(body.active);
    if (body.shopify_product_id !== undefined) {
      patch.shopify_product_id = body.shopify_product_id
        ? Number(body.shopify_product_id)
        : null;
    }
    if (body.shopify_variant_id !== undefined) {
      patch.shopify_variant_id = body.shopify_variant_id
        ? Number(body.shopify_variant_id)
        : null;
    }

    const { data, error } = await supabase
      .from("reparatie_standaard_items")
      .update(patch)
      .eq("id", id)
      .eq("owner_email", ownerEmail)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ item: data as ReparatieStandaardItem });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bijwerken mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
    if (!id) {
      return NextResponse.json({ error: "id verplicht." }, { status: 400 });
    }
    const supabase = createServerSupabaseClient();
    // Soft-delete: active=false
    const { error } = await supabase
      .from("reparatie_standaard_items")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_email", ownerEmail);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Verwijderen mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
