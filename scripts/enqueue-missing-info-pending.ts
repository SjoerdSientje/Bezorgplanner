/**
 * Eenmalig: actieve Shopify-producten die niet aan info@-voorraadregels hangen
 * → wachtrij “Nieuwe producten” (pending). Maakt géén inventory_products op info@.
 *
 * Run: npx tsx scripts/enqueue-missing-info-pending.ts
 * Dry-run (default): geen writes. Apply: --apply
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  if (!process.env[k]) process.env[k] = line.slice(i + 1);
}
import {
  enqueueInventoryPendingProduct,
  isShopifyProductLinkedToInventory,
} from "../src/lib/inventory-pending";
import { isExcludedFromInventory } from "../src/lib/inventory-rules";
import {
  fetchAllShopifyProducts,
  isShopifyProductActive,
  type ShopifyAdminProduct,
} from "../src/lib/shopify-admin";

const INFO = "info@koopjefatbike.nl";
const MALYAR = "malyar@aiventive.nl";
const apply = process.argv.includes("--apply");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env ontbreekt");

  const supabase = createClient(url, key);
  const products = await fetchAllShopifyProducts({ status: "active" });
  const active = products.filter(isShopifyProductActive);

  const { data: malyarRows } = await supabase
    .from("inventory_products")
    .select("id, title, shopify_product_id, shopify_variant_ids, category, stock_quantity")
    .eq("owner_email", MALYAR);

  type MalyarRow = {
    id: string;
    title: string;
    shopify_product_id: number | null;
    shopify_variant_ids: number[] | null;
    category: string;
    stock_quantity: number;
  };
  const malyarByPid = new Map<number, MalyarRow>();
  for (const r of (malyarRows ?? []) as MalyarRow[]) {
    const pid = Number(r.shopify_product_id);
    if (pid) malyarByPid.set(pid, r);
  }

  const candidates: ShopifyAdminProduct[] = [];
  const skippedExcluded: string[] = [];
  const skippedLinked: string[] = [];

  for (const product of active) {
    const pid = Number(product.id);
    const title = String(product.title ?? "").trim();
    if (isExcludedFromInventory(product)) {
      skippedExcluded.push(title);
      continue;
    }
    const vids = (product.variants ?? [])
      .map((v) => Number(v.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const linked = await isShopifyProductLinkedToInventory(
      supabase,
      INFO,
      pid,
      vids
    );
    if (linked) {
      skippedLinked.push(title);
      continue;
    }
    candidates.push(product);
  }

  console.log(
    JSON.stringify(
      {
        apply,
        activeShopify: active.length,
        skippedExcluded: skippedExcluded.length,
        skippedAlreadyLinkedInfo: skippedLinked.length,
        missingOnInfo: candidates.length,
        missing: candidates.map((p) => ({
          id: Number(p.id),
          title: p.title,
          onMalyar: malyarByPid.has(Number(p.id))
            ? {
                title: malyarByPid.get(Number(p.id))!.title,
                category: malyarByPid.get(Number(p.id))!.category,
                stock: malyarByPid.get(Number(p.id))!.stock_quantity,
              }
            : null,
        })),
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log("\nDry-run. Run opnieuw met --apply om te enqueue’en.");
    return;
  }

  let enqueued = 0;
  let alreadyPending = 0;
  const errors: Array<{ id: number; error: string }> = [];

  for (const product of candidates) {
    try {
      const result = await enqueueInventoryPendingProduct(supabase, INFO, product);
      if (result.enqueued) enqueued++;
      else alreadyPending++;
    } catch (e) {
      errors.push({
        id: Number(product.id),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log(
    JSON.stringify({ enqueued, alreadyPendingOrUpdated: alreadyPending, errors }, null, 2)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
