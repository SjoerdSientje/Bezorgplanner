/**
 * Backfill Shopify-pakketjes (< €450 + €0 garantie/nalevering) sinds 1 okt 2026
 * naar `orders` (klant-ordergeschiedenis), met Moneybird-factuur erbij.
 *
 * Dry-run:  npx tsx scripts/backfill-pakketjes-order-history.ts
 * Apply:    npx tsx scripts/backfill-pakketjes-order-history.ts --apply
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1].trim();
  let v = m[2].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const APPLY = process.argv.includes("--apply");
/** PDF download is traag; standaard alleen moneybird_invoice_id zetten. */
const ATTACH_PDF = process.argv.includes("--pdf");

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  // Dynamic import ná .env.local laden (supabase/moneybird modules lezen env bij init).
  const { backfillPakketjesOrderHistory } = await import(
    "../src/lib/pakketjes-order-history"
  );

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  console.log(
    APPLY
      ? `APPLY: schrijf pakketjes naar ordergeschiedenis${ATTACH_PDF ? " (+ PDF)" : " (zonder PDF)"}…`
      : "DRY-RUN: geen writes (gebruik --apply om te schrijven)…"
  );

  const stats = await backfillPakketjesOrderHistory(supabase, {
    dryRun: !APPLY,
    attachFactuur: APPLY && ATTACH_PDF,
  });

  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
