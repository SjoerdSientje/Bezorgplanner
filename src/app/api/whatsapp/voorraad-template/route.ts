import { NextRequest, NextResponse } from "next/server";
import { requireAccountEmail } from "@/lib/account";
import {
  createInventoryAlertTemplates,
  fetchWhatsAppTemplates,
  INVENTORY_ALERT_TEMPLATE_LOW,
  INVENTORY_ALERT_TEMPLATE_OUT,
} from "@/lib/whatsapp";

/**
 * POST /api/whatsapp/voorraad-template
 * Dient beide Meta-templates in: voorraad_laag_3 + voorraad_uitverkocht.
 */
export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const created = await createInventoryAlertTemplates();
    if (!created.ok) {
      return NextResponse.json(
        { ok: false, error: created.error, results: created.results },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      language: created.language,
      results: created.results,
      message:
        "Templates ingediend/gevonden. Status PENDING → wacht op Meta-goedkeuring (vaak minuten tot uren).",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 401 }
    );
  }
}

/** GET: status van beide voorraad-templates. */
export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const names = [INVENTORY_ALERT_TEMPLATE_LOW, INVENTORY_ALERT_TEMPLATE_OUT];
    const fetched = await fetchWhatsAppTemplates();
    if (!fetched.ok) {
      return NextResponse.json({ ok: false, error: fetched.error }, { status: 400 });
    }
    const matches = (fetched.templates ?? []).filter((t) =>
      names.includes(String(t.name ?? ""))
    );
    return NextResponse.json({
      ok: true,
      names,
      templates: matches.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 401 }
    );
  }
}
