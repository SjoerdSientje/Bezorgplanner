import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getInventoryScanOwnerEmail } from "@/lib/account";
import { pruneInactiveInventoryProducts } from "@/lib/inventory";
import { syncInventoryLevertijdFromShopifyMetafields } from "@/lib/inventory-levertijd";
import { getAmsterdamCalendarDate } from "@/lib/planning-date";
import { isShopifyAdminConfigured } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dagelijks ~07:00 Amsterdam: levertijd in voorraad syncen vanuit
 * custom.levertijd + custom.restock_datum (geen metafield-webhook).
 *
 * Auth: Authorization Bearer CRON_SECRET (Vercel Cron), of ?force=1 met secret.
 * Schedule in vercel.json: 05:00 en 06:00 UTC; handler runt alleen als Amsterdam-uur = 7
 * (tenzij force).
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Zonder secret alleen in development toestaan met force
    return process.env.NODE_ENV === "development";
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const q = request.nextUrl.searchParams.get("secret");
  return q === secret;
}

function amsterdamHourNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force =
    request.nextUrl.searchParams.get("force") === "1" ||
    request.nextUrl.searchParams.get("force") === "true";

  const hour = amsterdamHourNow();
  if (!force && hour !== 7) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "not_7am_amsterdam",
      amsterdamHour: hour,
      amsterdamDate: getAmsterdamCalendarDate(0),
    });
  }

  if (!isShopifyAdminConfigured()) {
    return NextResponse.json({ error: "Shopify Admin API niet geconfigureerd" }, { status: 500 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const ownerEmail = getInventoryScanOwnerEmail();

  try {
    const pruned = await pruneInactiveInventoryProducts(supabase, ownerEmail);
    const result = await syncInventoryLevertijdFromShopifyMetafields(supabase, ownerEmail);
    return NextResponse.json({
      ok: true,
      ownerEmail,
      amsterdamDate: getAmsterdamCalendarDate(0),
      amsterdamHour: hour,
      forced: force,
      pruned,
      ...result,
    });
  } catch (e) {
    console.error("[cron/inventory-levertijd]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync mislukt" },
      { status: 500 }
    );
  }
}
