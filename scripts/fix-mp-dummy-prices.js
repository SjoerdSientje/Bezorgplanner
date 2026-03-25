/**
 * Eenmalig: MP-orders met fietsregels op prijs 999 (oude dummy) → prijs 0 in line_items_json.
 *
 * Run: node scripts/fix-mp-dummy-prices.js
 * Vereist .env.local met NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Optioneel: --dry-run (alleen loggen, geen updates)
 *
 * bestelling_totaal_prijs wordt niet automatisch aangepast (kan echt €999 zijn).
 * Als dat veld per ongeluk 999 is door opslaan uit de producten-editor, handmatig corrigeren.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
const raw = fs.readFileSync(envPath, "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const dryRun = process.argv.includes("--dry-run");

function hasLevering(properties) {
  return (properties ?? []).some(
    (p) =>
      String(p.name ?? "").trim().toLowerCase() === "levering" &&
      String(p.value ?? "").trim() !== ""
  );
}

function stripDummy999(jsonStr) {
  if (!jsonStr?.trim()) return { json: jsonStr, changed: false };
  let arr;
  try {
    arr = JSON.parse(jsonStr);
  } catch {
    return { json: jsonStr, changed: false };
  }
  if (!Array.isArray(arr)) return { json: jsonStr, changed: false };
  let changed = false;
  for (const item of arr) {
    if (item.price !== 999) continue;
    if (item.isFiets || hasLevering(item.properties)) {
      item.price = 0;
      changed = true;
    }
  }
  if (!changed) return { json: jsonStr, changed: false };
  return { json: JSON.stringify(arr), changed: true };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY nodig in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, source, line_items_json, order_nummer, bestelling_totaal_prijs")
    .eq("source", "mp")
    .not("line_items_json", "is", null);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  let updated = 0;
  for (const row of rows ?? []) {
    const j = row.line_items_json;
    if (typeof j !== "string" || !j.includes("999")) continue;

    const { json: nextJson, changed } = stripDummy999(j);
    if (!changed) continue;

    console.log(
      dryRun ? "[dry-run] zou updaten:" : "update:",
      row.order_nummer ?? row.id,
      row.id
    );
    if (Number(row.bestelling_totaal_prijs) === 999) {
      console.warn(
        "  → bestelling_totaal_prijs is 999: controleer of dit het echte totaal is (zo niet: handmatig aanpassen in de sheet)."
      );
    }

    if (!dryRun) {
      const { error: upErr } = await supabase
        .from("orders")
        .update({ line_items_json: nextJson })
        .eq("id", row.id);
      if (upErr) {
        console.error("Update mislukt", row.id, upErr);
        continue;
      }
    }
    updated += 1;
  }

  console.log(
    dryRun ? `Klaar (dry-run). ${updated} order(s) zouden worden bijgewerkt.` : `Klaar. ${updated} order(s) bijgewerkt.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
