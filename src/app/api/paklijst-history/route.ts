import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from("paklijst_history")
      .select("id, generated_at, data")
      .eq("owner_email", ownerEmail)
      .order("generated_at", { ascending: false })
      .limit(3);

    if (error) {
      console.error("[api/paklijst-history][GET]", error);
      return NextResponse.json({ error: "Historie ophalen mislukt." }, { status: 500 });
    }

    return NextResponse.json(
      { entries: data ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/paklijst-history][GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));
    const payload = body?.data;

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Ongeldige payload." }, { status: 400 });
    }

    const generatedAtRaw = String((payload as { generatedAt?: string }).generatedAt ?? "").trim();
    const generatedAt =
      generatedAtRaw && !Number.isNaN(new Date(generatedAtRaw).getTime())
        ? new Date(generatedAtRaw).toISOString()
        : new Date().toISOString();

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("paklijst_history")
      .insert({
        owner_email: ownerEmail,
        generated_at: generatedAt,
        data: payload,
      })
      .select("id, generated_at, data")
      .single();

    if (error) {
      console.error("[api/paklijst-history][POST]", error);
      return NextResponse.json({ error: "Historie opslaan mislukt." }, { status: 500 });
    }

    return NextResponse.json(
      { entry: data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/paklijst-history][POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
