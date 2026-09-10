/**
 * Eenmalig: rebuild onderdelen/accessoires-voorraad (na migratie 028).
 * Usage: npx tsx scripts/rebuild-parts-inventory.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { rebuildPartsInventoryFromShopifyCollections } from "../src/lib/inventory-parts-rebuild";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const ownerEmail = (
    process.env.INVENTORY_SCAN_OWNER_EMAIL || "info@koopjefatbike.nl"
  )
    .trim()
    .toLowerCase();

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const probe = await supabase
    .from("inventory_shopify_deductions")
    .select("id")
    .limit(1);
  if (probe.error) {
    console.error(
      "Migratie 028 ontbreekt (inventory_shopify_deductions). Voer eerst supabase/migrations/028_inventory_parts_accessoire_deductions.sql uit in de Supabase SQL Editor."
    );
    console.error(probe.error.message);
    process.exit(1);
  }

  console.log("Rebuild onderdelen/accessoires voor", ownerEmail, "…");
  const result = await rebuildPartsInventoryFromShopifyCollections(
    supabase,
    ownerEmail
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
