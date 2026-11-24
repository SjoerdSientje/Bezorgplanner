/**
 * Historische voorraad-herberekening v2 voor multi-variant regels.
 * expected = baseline_1_okt + inkomend − uitgaand(mutations) − gemiste verkopen
 * (Moneybird/MP-afhaal zitten in uitgaand; gemist = afgeronde orders zonder mutatie)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
for (const line of readFileSync(resolve(".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1].trim();
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const OWNER = "info@koopjefatbike.nl";
const FROM = "2026-09-30T22:00:00.000Z";
const domain = (process.env.SHOPIFY_SHOP_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function jsonbContains(v) {
  return JSON.stringify(v);
}
function skipName(name) {
  const n = String(name || "")
    .trim()
    .toLowerCase();
  if (!n) return true;
  if (["volledig rijklaar", "rijklaar", "in doos", "verzekering", "fietspompje"].includes(n))
    return true;
  if (
    n.includes("onderhoudspakket") ||
    n.includes("graag verzekeren") ||
    n.includes("opladerdoos")
  )
    return true;
  if (
    n.includes("achterzitje ouxi v8") ||
    n.includes("voorrekje voor fatbikes") ||
    n.includes("range rover velar")
  )
    return true;
  if (n.startsWith("voorrekje:") || n.startsWith("achterzitje:")) return true;
  return false;
}
function isHerberekening(note) {
  return /Historische herberekening/i.test(String(note || ""));
}
function amsDate(iso) {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
function normalizeRef(ref) {
  const s = String(ref || "").trim();
  if (!s) return [];
  const out = new Set([s.toLowerCase()]);
  const m = s.match(/shopify:(\d+)/i);
  if (m) out.add(m[1]);
  if (/^\d+$/.test(s)) out.add("shopify:" + s);
  if (s.startsWith("#")) out.add(s.toLowerCase());
  else out.add("#" + s.replace(/^#/, "").toLowerCase());
  return [...out];
}
function scoreMpToTarget(name, title) {
  const n = name.toLowerCase();
  const t = title.toLowerCase();
  let score = 0;
  if (n.includes("gt2000") && t.includes("gt2000")) score += 10;
  if (n.includes("e26") && t.includes("e26")) score += 10;
  if (n.includes("l20 boost") && t.includes("l20 boost")) score += 10;
  if (n.includes("l20") && !n.includes("boost") && t.includes("l20") && !t.includes("boost"))
    score += 8;
  if (n.includes("skinny") && t.includes("skinny")) score += 10;
  if (n.includes("6.0") && t.includes("6.0")) score += 10;
  if (n.includes("ultra mini") && t.includes("ultra mini")) score += 10;
  if ((n.includes("max ultra") || n.includes("ultra max")) && t.includes("max ultra")) score += 10;
  if (
    (n.includes("v8 ultra") || n.includes("ultra fatbike")) &&
    t.includes("ultra fatbike") &&
    !t.includes("mini") &&
    !t.includes("max")
  )
    score += 8;
  if (n.includes("v20 pro comfort") && t.includes("comfort")) score += 10;
  if (
    n.includes("v20 pro") &&
    t.includes("v20 pro") &&
    !t.includes("comfort") &&
    !n.includes("comfort")
  )
    score += 8;
  if (n.includes("v20 limited") && t.includes("limited")) score += 10;
  if (n.includes("ado air") && t.includes("ado air")) score += 10;
  if (n.includes("q8") && t.includes("q8")) score += 10;
  for (const c of [
    "zwart",
    "wit",
    "geel",
    "blauw",
    "groen",
    "oranje",
    "grijs",
    "roze",
    "bruin",
    "nardo",
    "rose",
  ]) {
    if (n.includes(c) && t.includes(c)) score += 3;
  }
  if (n.includes("lage instap") && t.includes("lage instap")) score += 3;
  if (n.includes("hoge instap") && t.includes("hoge instap")) score += 3;
  return score;
}

async function resolveByIds(product_id, variant_id) {
  if (variant_id) {
    const { data } = await sb
      .from("inventory_products")
      .select("id,title,category")
      .eq("owner_email", OWNER)
      .contains("shopify_variant_ids", jsonbContains([variant_id]))
      .maybeSingle();
    if (data) return data;
    const { data: l } = await sb
      .from("inventory_products")
      .select("id,title,category")
      .eq("owner_email", OWNER)
      .eq("shopify_variant_id", variant_id)
      .maybeSingle();
    if (l) return l;
  }
  if (product_id) {
    const { data } = await sb
      .from("inventory_products")
      .select("id,title,category")
      .eq("owner_email", OWNER)
      .eq("shopify_product_id", product_id)
      .order("stock_quantity", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

async function shopifyToken() {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("no shopify token: " + JSON.stringify(j));
  return j.access_token;
}

async function main() {
  console.log("start recalc v2...");
  const t = await shopifyToken();

  const { data: all, error: pe } = await sb
    .from("inventory_products")
    .select("*")
    .eq("owner_email", OWNER);
  if (pe) throw pe;
  const targets = (all || []).filter((p) => (p.shopify_variant_ids || []).length > 1);
  const targetIds = new Set(targets.map((p) => p.id));
  console.log("targets", targets.length);

  const { data: allOrders, error: oe } = await sb
    .from("orders")
    .select(
      "id, order_id, order_nummer, source, afgerond_at, status, producten, line_items_json, naam, created_at"
    )
    .eq("owner_email", OWNER)
    .gte("created_at", "2026-09-15");
  if (oe) throw oe;

  const orderByShopifyId = new Map();
  const orderByNummer = new Map();
  for (const o of allOrders || []) {
    if (o.order_id) orderByShopifyId.set(String(o.order_id), o);
    if (o.order_nummer) orderByNummer.set(String(o.order_nummer).toLowerCase(), o);
  }

  const state = {};
  for (const p of targets) {
    const { data: muts } = await sb
      .from("inventory_mutations")
      .select(
        "mutation_type,quantity,stock_before,stock_after,created_at,source,order_reference,note"
      )
      .eq("product_id", p.id)
      .gte("created_at", "2026-09-30")
      .order("created_at", { ascending: true });
    const mutsClean = (muts || []).filter((m) => !isHerberekening(m.note));

    let baseline = null;
    let baselineAt = null;
    for (const m of mutsClean) {
      if (
        amsDate(m.created_at) === "2026-10-01" &&
        (m.mutation_type === "correctie" || m.mutation_type === "inkomend")
      ) {
        baseline = m.stock_after;
        baselineAt = m.created_at;
      }
    }
    if (baseline == null) {
      for (const m of mutsClean) {
        if (amsDate(m.created_at) >= "2026-10-01") {
          baseline = m.stock_before;
          baselineAt = "before " + m.created_at;
          break;
        }
      }
    }
    if (baseline == null) baseline = p.stock_quantity;

    let incoming = 0;
    let uitgaand = 0;
    const covered = new Set();
    const uitgaandDetails = [];
    for (const m of mutsClean) {
      if (amsDate(m.created_at) < "2026-10-01") continue;
      if (
        baselineAt &&
        !String(baselineAt).startsWith("before") &&
        m.created_at <= baselineAt &&
        (m.mutation_type === "correctie" || m.mutation_type === "inkomend")
      )
        continue;
      if (m.mutation_type === "inkomend") incoming += Number(m.quantity || 0);
      if (
        m.mutation_type === "correctie" &&
        (!baselineAt || String(baselineAt).startsWith("before") || m.created_at > baselineAt)
      ) {
        incoming += Number(m.stock_after) - Number(m.stock_before);
      }
      if (m.mutation_type === "uitgaand") {
        uitgaand += Number(m.quantity || 0);
        uitgaandDetails.push({ source: m.source, ref: m.order_reference, qty: m.quantity });
        for (const r of normalizeRef(m.order_reference)) covered.add(r);
        const sid =
          (String(m.order_reference || "").match(/shopify:(\d+)/i) || [])[1] ||
          (/^\d{10,}$/.test(String(m.order_reference || ""))
            ? String(m.order_reference)
            : null);
        if (sid && orderByShopifyId.get(sid)?.order_nummer) {
          for (const r of normalizeRef(orderByShopifyId.get(sid).order_nummer)) covered.add(r);
        }
        const on = orderByNummer.get(String(m.order_reference || "").toLowerCase());
        if (on?.order_id) for (const r of normalizeRef(on.order_id)) covered.add(r);
      }
    }
    state[p.id] = {
      baseline,
      incoming,
      uitgaand,
      covered,
      uitgaandDetails,
      missed: 0,
      missedDetails: [],
      current: p.stock_quantity,
      title: p.title,
      category: p.category,
    };
  }

  const shopCompleted = (allOrders || []).filter(
    (x) => x.source === "shopify" && x.afgerond_at && x.afgerond_at >= FROM && x.order_id
  );
  console.log("fetching shopify orders", shopCompleted.length);
  for (const o of shopCompleted) {
    const refs = [
      ...normalizeRef(o.order_id),
      ...normalizeRef(o.order_nummer),
      ...normalizeRef("shopify:" + o.order_id),
    ];
    const r = await fetch(
      `https://${domain}/admin/api/2024-10/orders/${o.order_id}.json?fields=line_items,cancelled_at`,
      { headers: { "X-Shopify-Access-Token": t } }
    );
    if (!r.ok) {
      console.warn("shopify fetch fail", o.order_nummer, r.status);
      continue;
    }
    const j = await r.json();
    if (j.order?.cancelled_at) continue;
    for (const li of j.order?.line_items || []) {
      if (skipName(li.name) || Number(li.quantity || 0) <= 0) continue;
      const inv = await resolveByIds(Number(li.product_id), Number(li.variant_id));
      if (!inv || !targetIds.has(inv.id)) continue;
      const st = state[inv.id];
      if (refs.some((ref) => st.covered.has(ref))) continue;
      const qty = Math.max(1, Math.floor(Number(li.quantity || 1)));
      st.missed += qty;
      st.missedDetails.push({ order: o.order_nummer, source: "shopify-missed", qty });
      for (const ref of refs) st.covered.add(ref);
    }
  }

  for (const o of (allOrders || []).filter((x) => x.source === "mp")) {
    const isAfhaal = /^#?MPA/i.test(o.order_nummer || "");
    const completed = Boolean(o.afgerond_at && o.afgerond_at >= FROM);
    const afhaalSinceOct = isAfhaal && o.created_at && o.created_at >= FROM;
    if (!completed && !afhaalSinceOct) continue;
    const refs = [...normalizeRef(o.order_nummer), ...normalizeRef(o.id)];

    let lines = [];
    try {
      lines = JSON.parse(o.line_items_json || "[]");
    } catch {
      lines = [];
    }
    const candidates = [];
    for (const li of Array.isArray(lines) ? lines : []) {
      if (skipName(li.name)) continue;
      candidates.push(li);
    }
    if (!candidates.length && o.producten) {
      candidates.push({ name: o.producten.split("\n")[0], isFiets: true, quantity: 1 });
    }

    for (const li of candidates) {
      let inv = null;
      if (li.product_id || li.variant_id) {
        inv = await resolveByIds(Number(li.product_id), Number(li.variant_id));
      }
      if (!inv && li.isFiets !== false) {
        let best = null;
        for (const p of targets.filter((x) => x.category === "fiets")) {
          const score = scoreMpToTarget(String(li.name || ""), p.title);
          if (score >= 10 && (!best || score > best.score)) best = { p, score };
        }
        if (best) inv = best.p;
      }
      if (!inv || !targetIds.has(inv.id)) continue;
      const st = state[inv.id];
      if (refs.some((ref) => st.covered.has(ref))) continue;
      const qty = Math.max(1, Math.floor(Number(li.quantity || 1)));
      st.missed += qty;
      st.missedDetails.push({
        order: o.order_nummer,
        source: isAfhaal ? "mp-afhaal-missed" : "mp-missed",
        qty,
      });
      for (const ref of refs) st.covered.add(ref);
    }
  }

  const applied = [];
  for (const p of targets) {
    const st = state[p.id];
    const expected = Math.max(
      0,
      Math.floor(st.baseline + st.incoming - st.uitgaand - st.missed)
    );
    if (expected === st.current) continue;
    const note =
      `Historische herberekening v2 (1 okt 2026): baseline ${st.baseline}` +
      `${st.incoming ? ` + inkomend/correcties ${st.incoming}` : ""}` +
      ` − ${st.uitgaand} reeds afgeschreven (shopify/moneybird/mp)` +
      ` − ${st.missed} gemiste verkopen` +
      `. Was ${st.current}.`;

    const { error: uerr } = await sb
      .from("inventory_products")
      .update({ stock_quantity: expected, last_mutation_source: "handmatig" })
      .eq("id", p.id)
      .eq("owner_email", OWNER);
    if (uerr) throw uerr;
    const { error: merr } = await sb.from("inventory_mutations").insert({
      owner_email: OWNER,
      product_id: p.id,
      mutation_type: "correctie",
      quantity: Math.abs(expected - st.current),
      stock_before: st.current,
      stock_after: expected,
      source: "handmatig",
      note,
      order_reference: null,
      order_producten: null,
    });
    if (merr) throw merr;
    applied.push({
      title: p.title,
      from: st.current,
      to: expected,
      delta: expected - st.current,
      uitgaand: st.uitgaand,
      missed: st.missed,
      uitgaandDetails: st.uitgaandDetails,
      missedDetails: st.missedDetails,
    });
  }

  const { data: ouxi } = await sb
    .from("inventory_products")
    .select("stock_quantity")
    .eq("id", "48684d7a-9457-4c4e-890e-041e67a63930")
    .single();
  const { data: res } = await sb
    .from("inventory_reservations")
    .select("order_nummer,quantity")
    .eq("inventory_product_id", "48684d7a-9457-4c4e-890e-041e67a63930");

  const unchanged = targets
    .filter((p) => {
      const st = state[p.id];
      return (
        Math.max(0, Math.floor(st.baseline + st.incoming - st.uitgaand - st.missed)) ===
        st.current
      );
    })
    .map((p) => ({
      title: p.title,
      stock: state[p.id].current,
      uitgaand: state[p.id].uitgaand,
      missed: state[p.id].missed,
    }));

  console.log(
    JSON.stringify(
      {
        applied,
        unchanged,
        ouxi: { stock: ouxi.stock_quantity, reserved: res },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
