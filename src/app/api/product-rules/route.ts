import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { requireAccountEmail } from "@/lib/account";
import {
  DEFAULT_PRODUCT_RULES_V1,
  isProductDefaultItemsRulesV1,
  type ProductDefaultItemsRulesV1,
} from "@/lib/product-default-items-rules";

export const dynamic = "force-dynamic";

/**
 * GET: huidige regels (DB of default)
 * PUT: volledige regels overschrijven (JSON body { rules })
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

    const rules: ProductDefaultItemsRulesV1 =
      row?.rules != null && isProductDefaultItemsRulesV1(row.rules)
        ? row.rules
        : DEFAULT_PRODUCT_RULES_V1;

    return NextResponse.json(
      {
        rules,
        updated_at: row?.updated_at ?? null,
        fromDatabase: Boolean(row?.rules && isProductDefaultItemsRulesV1(row.rules)),
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
    if (!isProductDefaultItemsRulesV1(candidate)) {
      return NextResponse.json(
        { error: "Ongeldige regels (verwacht version: 1 met verplichte arrays)." },
        { status: 400 }
      );
    }
    const rules = candidate as ProductDefaultItemsRulesV1;

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
