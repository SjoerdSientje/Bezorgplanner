import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type IncomingDeliveryRow = {
  id: string;
  owner_email: string;
  track_trace_url: string;
  note: string | null;
  status: "pending" | "received";
  created_at: string;
  received_at: string | null;
  updated_at: string;
};

function isValidTrackUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    // Plakken zonder protocol mag — we slaan het op zoals ingevoerd als er iets nuttigs in zit
    return s.length >= 4;
  }
}

export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from("incoming_deliveries")
      .select("*")
      .eq("owner_email", ownerEmail)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[incoming-deliveries] GET", error);
      return NextResponse.json(
        { error: "Ophalen mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as IncomingDeliveryRow[];
    return NextResponse.json(
      {
        pending: rows.filter((r) => r.status === "pending"),
        received: rows.filter((r) => r.status === "received"),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ophalen mislukt." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = await request.json().catch(() => ({}));
    const trackTraceUrl = String(body.track_trace_url ?? "").trim();
    const noteRaw = String(body.note ?? "").trim();
    const note = noteRaw || null;

    if (!isValidTrackUrl(trackTraceUrl)) {
      return NextResponse.json(
        { error: "Plak een geldige track & trace-link." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("incoming_deliveries")
      .insert({
        owner_email: ownerEmail,
        track_trace_url: trackTraceUrl,
        note,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) {
      console.error("[incoming-deliveries] POST", error);
      return NextResponse.json(
        { error: "Opslaan mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, delivery: data as IncomingDeliveryRow });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Opslaan mislukt." },
      { status: 500 }
    );
  }
}

/** Markeer als ontvangen: body { id } of { id, action: "receive" } */
export async function PATCH(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Ontbrekende id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const receivedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from("incoming_deliveries")
      .update({
        status: "received",
        received_at: receivedAt,
      })
      .eq("id", id)
      .eq("owner_email", ownerEmail)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[incoming-deliveries] PATCH", error);
      return NextResponse.json(
        { error: "Bijwerken mislukt.", detail: error.message },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "Levering niet gevonden of al ontvangen." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, delivery: data as IncomingDeliveryRow });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bijwerken mislukt." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const id =
      request.nextUrl.searchParams.get("id")?.trim() ||
      String((await request.json().catch(() => ({}))).id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Ontbrekende id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from("incoming_deliveries")
      .delete()
      .eq("id", id)
      .eq("owner_email", ownerEmail);

    if (error) {
      console.error("[incoming-deliveries] DELETE", error);
      return NextResponse.json(
        { error: "Verwijderen mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verwijderen mislukt." },
      { status: 500 }
    );
  }
}
