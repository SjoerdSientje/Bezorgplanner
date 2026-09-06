import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import {
  DEFAULT_PRODUCT_RULES_V2,
  isProductDefaultItemsRules,
  normalizeProductDefaultItemsRules,
  type ProductDefaultItemsRulesV2,
} from "@/lib/product-default-items-rules";

export const dynamic = "force-dynamic";

/**
 * GET: huidige regels (DB of default), altijd als v2
 * PUT: volledige regels overschrijven (JSON body { rules } — version 2)
 */
export async function GET(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const supabase = createServerSupabaseClient();
    const { data: row } = await supabase
      .from("product_default_items_rules")
      .select("rules, updated_at")
      .eq("owner_email", ownerEmail)
      .eq("id", "default")
      .maybeSingle();

    const fromDatabase = Boolean(row?.rules);
    const rules: ProductDefaultItemsRulesV2 = fromDatabase
      ? normalizeProductDefaultItemsRules(row!.rules)
      : DEFAULT_PRODUCT_RULES_V2;

    return NextResponse.json(
      {
        rules,
        updated_at: row?.updated_at ?? null,
        fromDatabase,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));
    const candidate = body.rules as unknown;
    if (!isProductDefaultItemsRules(candidate)) {
      return NextResponse.json(
        { error: "Ongeldige regels (verwacht version 1 of 2)." },
        { status: 400 }
      );
    }
    // Accepteer v1 (migratie) of v2; sla altijd v2 op.
    const rules = normalizeProductDefaultItemsRules(candidate);

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from("product_default_items_rules").upsert(
      {
        owner_email: ownerEmail,
        id: "default",
        rules,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_email,id" }
    );

    if (error) {
      console.error("[api/product-rules] upsert", error);
      return NextResponse.json(
        { error: "Opslaan mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, rules });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
