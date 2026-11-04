/**
 * Voeg voorraadregels samen die hetzelfde Shopify-product én dezelfde
 * variant-set hebben (echte duplicaten). Rood/zwart-kabel op één product
 * zijn GEEN duplicaten — die hebben verschillende variant-ids.
 *
 * Stock: som van alle >0 (of 0 als alles 0). Survivor: bij voorkeur parts:-regel.
 *
 * Dry-run default. Apply: --apply
 * Run: npx tsx scripts/merge-duplicate-inventory-rules.ts [--apply]
 */
import { readFileSync } from "fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  if (!process.env[k]) process.env[k] = line.slice(i + 1);
}

const OWNER = "info@koopjefatbike.nl";
const apply = process.argv.includes("--apply");

type Row = {
  id: string;
  title: string;
  category: string;
  stock_quantity: number;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
  shopify_variant_ids: number[] | null;
  group_key: string | null;
  model_name: string | null;
  color_name: string | null;
  moneybird_product_ids: string[] | null;
  levertijd: string | null;
  restock_datum: string | null;
  opmerking: string | null;
  low_stock_threshold: number | null;
  image_url: string | null;
  created_at: string;
};

function unionNums(...lists: Array<Iterable<number | null | undefined>>): number[] {
  const s = new Set<number>();
  for (const list of lists) {
    for (const v of list) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) s.add(n);
    }
  }
  return [...s].sort((a, b) => a - b);
}

function pickSurvivor(group: Row[]): Row {
  const parts = group.filter((r) => String(r.group_key ?? "").startsWith("parts:"));
  if (parts.length === 1) return parts[0];
  if (parts.length > 1) {
    return [...parts].sort(
      (a, b) => Number(b.stock_quantity) - Number(a.stock_quantity)
    )[0];
  }
  return [...group].sort(
    (a, b) => Number(b.stock_quantity) - Number(a.stock_quantity)
  )[0];
}

function mergedStock(group: Row[]): number {
  const positives = group
    .map((r) => Number(r.stock_quantity) || 0)
    .filter((n) => n > 0);
  if (positives.length === 0) return 0;
  return positives.reduce((a, b) => a + b, 0);
}

async function retarget(
  supabase: SupabaseClient,
  fromId: string,
  toId: string
): Promise<void> {
  await supabase
    .from("incoming_delivery_items")
    .update({ product_id: toId })
    .eq("owner_email", OWNER)
    .eq("product_id", fromId);

  await supabase
    .from("inventory_reservations")
    .update({ inventory_product_id: toId })
    .eq("owner_email", OWNER)
    .eq("inventory_product_id", fromId);

  await supabase
    .from("inventory_mutations")
    .update({ inventory_product_id: toId })
    .eq("inventory_product_id", fromId);

  // Deductions: verplaats naar survivor; conflict op (owner, shopify_product) → loser-rij weg.
  const { data: deds } = await supabase
    .from("inventory_shopify_deductions")
    .select("*")
    .eq("owner_email", OWNER)
    .eq("inventory_product_id", fromId);

  for (const d of deds ?? []) {
    const { data: existing } = await supabase
      .from("inventory_shopify_deductions")
      .select("id")
      .eq("owner_email", OWNER)
      .eq("shopify_product_id", d.shopify_product_id)
      .eq("inventory_product_id", toId)
      .maybeSingle();
    if (existing?.id) {
      await supabase.from("inventory_shopify_deductions").delete().eq("id", d.id);
    } else {
      await supabase
        .from("inventory_shopify_deductions")
        .update({ inventory_product_id: toId })
        .eq("id", d.id);
    }
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env ontbreekt");
  const supabase = createClient(url, key);

  const { data: rowsRaw, error } = await supabase
    .from("inventory_products")
    .select(
      "id,title,category,stock_quantity,shopify_product_id,shopify_variant_id,shopify_variant_ids,group_key,model_name,color_name,moneybird_product_ids,levertijd,restock_datum,opmerking,low_stock_threshold,image_url,created_at"
    )
    .eq("owner_email", OWNER);
  if (error) throw new Error(error.message);
  const rows = (rowsRaw ?? []) as Row[];

  // Groepeer op product-id + exacte variant-set (niet alleen product-id).
  const bySig = new Map<string, { pid: number; g: Row[] }>();
  for (const r of rows) {
    const pid = Number(r.shopify_product_id);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const variants = unionNums([
      r.shopify_variant_id,
      ...(r.shopify_variant_ids ?? []),
    ]);
    if (variants.length === 0) continue;
    const sig = `${pid}::${JSON.stringify(variants)}`;
    if (!bySig.has(sig)) bySig.set(sig, { pid, g: [] });
    bySig.get(sig)!.g.push(r);
  }

  const groups = [...bySig.values()].filter(({ g }) => g.length > 1);

  console.log(
    JSON.stringify(
      {
        apply,
        owner: OWNER,
        duplicateGroups: groups.length,
        plan: groups.map(({ pid, g }) => {
          const survivor = pickSurvivor(g);
          const losers = g.filter((r) => r.id !== survivor.id);
          return {
            shopify_product_id: pid,
            keep: {
              id: survivor.id,
              title: survivor.title,
              key: survivor.group_key,
              stockBefore: survivor.stock_quantity,
            },
            remove: losers.map((r) => ({
              id: r.id,
              title: r.title,
              key: r.group_key,
              stock: r.stock_quantity,
            })),
            stockAfter: mergedStock(g),
            variantsAfter: unionNums(
              ...g.map((r) => [
                r.shopify_variant_id,
                ...(r.shopify_variant_ids ?? []),
              ])
            ),
          };
        }),
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log("\nDry-run. Run met --apply om samen te voegen.");
    return;
  }

  const results: Array<Record<string, unknown>> = [];

  for (const { pid, g } of groups) {
    const survivor = pickSurvivor(g);
    const losers = g.filter((r) => r.id !== survivor.id);
    const stock = mergedStock(g);
    const variants = unionNums(
      ...g.map((r) => [r.shopify_variant_id, ...(r.shopify_variant_ids ?? [])])
    );
    const moneybird = [
      ...new Set(
        g.flatMap((r) => (r.moneybird_product_ids ?? []).map(String)).filter(Boolean)
      ),
    ];

    // Meta: voorkeur survivor, anders eerste niet-lege uit de groep.
    const pickMeta = <T>(fn: (r: Row) => T | null | undefined): T | null => {
      const fromSurvivor = fn(survivor);
      if (fromSurvivor != null && String(fromSurvivor).trim() !== "") {
        return fromSurvivor as T;
      }
      for (const r of g) {
        const v = fn(r);
        if (v != null && String(v).trim() !== "") return v as T;
      }
      return null;
    };

    for (const loser of losers) {
      await retarget(supabase, loser.id, survivor.id);
    }

    const { error: updErr } = await supabase
      .from("inventory_products")
      .update({
        stock_quantity: stock,
        shopify_variant_ids: variants,
        shopify_variant_id: variants[0] ?? survivor.shopify_variant_id,
        moneybird_product_ids: moneybird,
        levertijd: pickMeta((r) => r.levertijd),
        restock_datum: pickMeta((r) => r.restock_datum),
        opmerking: pickMeta((r) => r.opmerking),
        low_stock_threshold:
          survivor.low_stock_threshold ??
          g.find((r) => r.low_stock_threshold != null)?.low_stock_threshold ??
          null,
        image_url: pickMeta((r) => r.image_url),
        // Kleur-suffix weg: parts-titel zonder "— Zwart" is schoner.
        color_name: String(survivor.group_key ?? "").startsWith("parts:")
          ? null
          : survivor.color_name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", survivor.id)
      .eq("owner_email", OWNER);

    if (updErr) throw new Error(`update ${survivor.id}: ${updErr.message}`);

    for (const loser of losers) {
      const { error: delErr } = await supabase
        .from("inventory_products")
        .delete()
        .eq("id", loser.id)
        .eq("owner_email", OWNER);
      if (delErr) throw new Error(`delete ${loser.id}: ${delErr.message}`);
    }

    results.push({
      shopify_product_id: pid,
      kept: survivor.title,
      keptId: survivor.id,
      removed: losers.map((l) => l.title),
      stock,
      variants,
    });
  }

  console.log(JSON.stringify({ merged: results.length, results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
