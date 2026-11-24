/**
 * Koppel Moneybird-verkoopfacturen aan Mollie-uitbetalingen sinds 1 okt 2026.
 *
 * Snel pad: 1× data laden (Mollie/Shopify/Moneybird), daarna alleen writes
 * met vaste pacing (voorkomt Moneybird 429-storm).
 *
 * Dry-run:  node scripts/backfill-mollie-payout-links.mjs
 * Apply:    node scripts/backfill-mollie-payout-links.mjs --apply
 */
import { readFileSync } from "fs";
import { resolve } from "path";

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
const SINCE = "2026-10-01";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2025-01";
/** Max ~40 Moneybird writes/min — onder hun rate limit blijven. */
const WRITE_GAP_MS = 1600;

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
function parseAmt(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const mollieKey = requireEnv("MOLLIE_API_KEY");
const mbAdmin = requireEnv("MONEYBIRD_ADMINISTRATION_ID");
const mbToken = requireEnv("MONEYBIRD_API_TOKEN");
const shopDomain = requireEnv("SHOPIFY_SHOP_DOMAIN")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const shopifyClientId = requireEnv("SHOPIFY_CLIENT_ID");
const shopifyClientSecret = requireEnv("SHOPIFY_CLIENT_SECRET");

let shopifyToken = null;
let shopifyTokenExpires = 0;
let lastMbWrite = 0;

async function getShopifyToken() {
  if (shopifyToken && Date.now() < shopifyTokenExpires - 60_000) return shopifyToken;
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: shopifyClientId,
      client_secret: shopifyClientSecret,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify token ${res.status}: ${text}`);
  const data = JSON.parse(text);
  shopifyToken = data.access_token;
  shopifyTokenExpires = Date.now() + (Number(data.expires_in) || 86400) * 1000;
  return shopifyToken;
}

async function shopifyGql(query, variables) {
  const token = await getShopifyToken();
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      }
    );
    const data = await res.json();
    const throttle = data.extensions?.cost?.throttleStatus;
    if (throttle && throttle.currentlyAvailable < 100) {
      await sleep(1000);
    }
    if (data.errors?.some((e) => /throttl/i.test(String(e.message || "")))) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (data.errors?.length) {
      throw new Error(`Shopify GQL: ${JSON.stringify(data.errors).slice(0, 300)}`);
    }
    return data.data;
  }
  throw new Error("Shopify GQL throttle retries exhausted");
}

async function mollieFetch(path) {
  const url = path.startsWith("http")
    ? path
    : `https://api.mollie.com/v2${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${mollieKey}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Mollie ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function mbFetch(path, opts = {}) {
  const isWrite = Boolean(opts.method && opts.method !== "GET");
  if (isWrite) {
    const wait = WRITE_GAP_MS - (Date.now() - lastMbWrite);
    if (wait > 0) await sleep(wait);
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://moneybird.com/api/v2/${mbAdmin}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${mbToken}`,
        Accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers || {}),
      },
    });
    const text = await res.text();
    if (res.status === 429) {
      const wait = 45_000 + attempt * 15_000;
      console.log(`  … Moneybird 429, wacht ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (isWrite) lastMbWrite = Date.now();
    if (!res.ok) {
      const err = new Error(`Moneybird ${res.status}: ${text.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }
  throw new Error("Moneybird 429: retries exhausted");
}

async function listMollieIncomingMutationsSince(sinceDate) {
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = sinceDate.replace(/-/g, "");
  const sync = await mbFetch(
    `/financial_mutations/synchronization.json?filter=${encodeURIComponent(
      `period:${start}..${end}`
    )}`
  );
  const ids = Array.isArray(sync) ? sync.map((x) => x.id) : [];
  const muts = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = await mbFetch(`/financial_mutations/synchronization.json`, {
      method: "POST",
      body: JSON.stringify({ ids: ids.slice(i, i + 100) }),
    });
    if (Array.isArray(batch)) muts.push(...batch);
  }
  return muts
    .filter((m) => /mollie/i.test(`${m.contra_account_name || ""}`))
    .filter((m) => parseAmt(m.amount) > 0)
    .filter((m) => String(m.date || "") >= sinceDate)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function listSettledPaymentsGrouped() {
  const settlements = new Map();
  let next = "/payments?limit=250";
  let pages = 0;
  while (next && pages < 50) {
    pages++;
    const data = await mollieFetch(next);
    const pays = data?._embedded?.payments || [];
    if (!pays.length) break;
    const oldest = pays[pays.length - 1]?.createdAt || "";
    for (const p of pays) {
      const status = String(p.status || "").toLowerCase();
      if (status !== "paid" && status !== "authorized") continue;
      const sid =
        p.settlementId ||
        (p._links?.settlement?.href || "").split("/").filter(Boolean).pop();
      if (!sid) continue;
      const paidAt = p.paidAt || p.createdAt || "";
      if (paidAt && paidAt < "2026-09-20") continue;
      const rec = settlements.get(sid) || {
        id: sid,
        payments: [],
        sumSettlement: 0,
        minPaid: null,
        maxPaid: null,
      };
      const amount = parseAmt(p.amount?.value);
      const settlementAmount = parseAmt(p.settlementAmount?.value) || amount;
      rec.payments.push({
        id: String(p.id),
        amount,
        settlementAmount,
        paidAt,
        description: p.description != null ? String(p.description) : null,
        shopifyPaymentId:
          p.metadata?.shopify_payment_id != null
            ? String(p.metadata.shopify_payment_id)
            : null,
      });
      rec.sumSettlement += settlementAmount;
      if (!rec.minPaid || paidAt < rec.minPaid) rec.minPaid = paidAt;
      if (!rec.maxPaid || paidAt > rec.maxPaid) rec.maxPaid = paidAt;
      settlements.set(sid, rec);
    }
    if (oldest && oldest < "2026-09-20") break;
    next =
      data?._links?.next?.href?.replace("https://api.mollie.com/v2", "") || null;
  }
  return [...settlements.values()].sort((a, b) =>
    String(a.maxPaid || "").localeCompare(String(b.maxPaid || ""))
  );
}

function pairSettlementsToMutations(settlements, mutations) {
  const usedStl = new Set();
  const pairs = [];
  for (const mutation of mutations) {
    const mDate = String(mutation.date || "");
    let best = null;
    let bestScore = Infinity;
    for (const stl of settlements) {
      if (usedStl.has(stl.id)) continue;
      const maxPaid = String(stl.maxPaid || "").slice(0, 10);
      if (!maxPaid) continue;
      const days = (Date.parse(mDate) - Date.parse(maxPaid)) / 86400000;
      if (days < -0.5 || days > 5) continue;
      const score = Math.abs(days - 1);
      if (score < bestScore) {
        bestScore = score;
        best = stl;
      }
    }
    if (best) usedStl.add(best.id);
    pairs.push({ mutation, settlement: best });
  }
  return pairs;
}

function parseReparatieUuid(description) {
  const m = String(description || "").match(
    /reparatie:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return m ? m[1] : null;
}

/** Één keer Shopify-orders laden → map paymentId → orderId */
async function buildShopifyPaymentMap() {
  const map = new Map();
  let cursor = null;
  let pages = 0;
  console.log("Shopify orders laden…");
  while (pages < 40) {
    pages++;
    const data = await shopifyGql(
      `query ($cursor: String) {
        orders(first: 50, after: $cursor, query: "processed_at:>=2026-09-20", sortKey: PROCESSED_AT) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              name
              transactions(first: 15) { paymentId gateway kind status }
            }
          }
        }
      }`,
      { cursor }
    );
    const conn = data?.orders;
    for (const edge of conn?.edges || []) {
      const node = edge.node;
      const orderId = String(node.id).replace(/^gid:\/\/shopify\/Order\//, "");
      for (const tx of node.transactions || []) {
        const pid = String(tx.paymentId || "").trim();
        if (pid) map.set(pid, { orderId, orderName: node.name || null });
      }
    }
    process.stdout.write(`  page ${pages}, map=${map.size}\r`);
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  console.log(`\nShopify payment→order map: ${map.size}`);
  return map;
}

/** Één keer Moneybird-facturen laden → map reference → invoice */
async function buildInvoiceMap() {
  const map = new Map();
  console.log("Moneybird facturen laden…");
  for (const period of ["202609..202611", "202608..202609"]) {
    let page = 1;
    while (page <= 40) {
      const list = await mbFetch(
        `/sales_invoices.json?filter=${encodeURIComponent(
          `period:${period}`
        )}&per_page=100&page=${page}`
      );
      if (!Array.isArray(list) || list.length === 0) break;
      for (const inv of list) {
        const ref = String(inv.reference || "").trim();
        if (ref) map.set(ref, inv);
      }
      process.stdout.write(`  ${period} page ${page}, map=${map.size}\r`);
      if (list.length < 100) break;
      page++;
      await sleep(200);
    }
  }
  console.log(`\nMoneybird invoice map: ${map.size}`);
  return map;
}

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: dry-run");
  console.log(`Mollie-uitbetalingen sinds ${SINCE}\n`);

  console.log("1/4 Moneybird mutaties…");
  const mutations = await listMollieIncomingMutationsSince(SINCE);
  for (const m of mutations) {
    console.log(
      `  ${m.date} €${m.amount} open=${m.amount_open} state=${m.state}`
    );
  }

  console.log("\n2/4 Mollie settlements…");
  const settlements = await listSettledPaymentsGrouped();
  console.log(`  ${settlements.length} settlements`);

  console.log("\n3/4 Lookups cachen…");
  const [shopMap, invMap] = await Promise.all([
    buildShopifyPaymentMap(),
    buildInvoiceMap(),
  ]);

  const pairs = pairSettlementsToMutations(settlements, mutations);
  const stats = {
    already: 0,
    linked: 0,
    registered: 0,
    skipped: 0,
    errors: 0,
  };

  console.log("\n4/4 Koppelen…");
  for (const { mutation, settlement } of pairs) {
    if (!settlement) {
      console.log(`✗ geen settlement voor ${mutation.date}`);
      continue;
    }
    const alreadyTr = new Set(
      (mutation.payments || [])
        .map((p) => String(p.transaction_identifier || "").trim())
        .filter((t) => t.startsWith("tr_"))
    );
    let openLeft = parseAmt(mutation.amount_open);
    console.log(
      `\n▸ ${mutation.date} open €${openLeft.toFixed(2)} ↔ ${settlement.id} (${settlement.payments.length} bets)`
    );

    for (const payment of settlement.payments) {
      if (alreadyTr.has(payment.id)) {
        stats.already++;
        continue;
      }
      if (openLeft < 0.01) {
        stats.skipped++;
        continue;
      }

      let ref = null;
      const reparatieUuid = parseReparatieUuid(payment.description);
      if (reparatieUuid) {
        ref = `reparatie:${reparatieUuid}`;
      } else {
        const shopifyPaymentId =
          payment.shopifyPaymentId ||
          (String(payment.description || "").startsWith("r")
            ? String(payment.description)
            : null);
        if (!shopifyPaymentId) {
          stats.skipped++;
          continue;
        }
        const order = shopMap.get(shopifyPaymentId);
        if (!order?.orderId) {
          stats.skipped++;
          console.log(`  skip geen order voor ${shopifyPaymentId}`);
          continue;
        }
        ref = `shopify:${order.orderId}`;
      }

      let invoice = invMap.get(ref) || null;
      if (!invoice) {
        // late/missing in period cache — één keer opzoeken
        try {
          invoice = await mbFetch(
            `/sales_invoices/find_by_reference/${encodeURIComponent(ref)}.json`
          );
          if (invoice?.reference) invMap.set(String(invoice.reference), invoice);
        } catch {
          invoice = null;
        }
      }
      if (!invoice?.id) {
        stats.skipped++;
        console.log(`  skip geen factuur ${ref}`);
        continue;
      }

      const existingPay = (invoice.payments || []).find(
        (p) => String(p.transaction_identifier || "").trim() === payment.id
      );
      if (existingPay?.financial_mutation_id) {
        if (String(existingPay.financial_mutation_id) === String(mutation.id)) {
          stats.already++;
        } else {
          stats.skipped++;
        }
        continue;
      }

      const label = `${payment.id} €${payment.amount} ${ref} (${invoice.invoice_id || invoice.state})`;

      try {
        if (existingPay?.id) {
          if (!APPLY) {
            console.log(`  would link payment ${label}`);
            stats.linked++;
            openLeft = Math.max(0, openLeft - parseAmt(existingPay.price));
            continue;
          }
          await mbFetch(
            `/financial_mutations/${mutation.id}/link_booking.json`,
            {
              method: "PATCH",
              body: JSON.stringify({
                booking_type: "Payment",
                booking_id: String(existingPay.id),
              }),
            }
          );
          console.log(`  linked payment ${label}`);
          stats.linked++;
          openLeft = Math.max(0, openLeft - parseAmt(existingPay.price));
          continue;
        }

        const unpaid = parseAmt(invoice.total_unpaid);
        if (!(unpaid > 0.009)) {
          stats.skipped++;
          console.log(`  skip al betaald ${label}`);
          continue;
        }

        const price = Math.min(payment.amount, unpaid, openLeft);
        const isDraft = String(invoice.state || "").toLowerCase() === "draft";

        if (!APPLY) {
          console.log(
            `  would ${isDraft ? "link invoice" : "register+link"} ${label}`
          );
          stats.linked++;
          stats.registered++;
          openLeft = Math.max(0, openLeft - price);
          continue;
        }

        if (isDraft) {
          await mbFetch(
            `/financial_mutations/${mutation.id}/link_booking.json`,
            {
              method: "PATCH",
              body: JSON.stringify({
                booking_type: "SalesInvoice",
                booking_id: String(invoice.id),
                price_base: price.toFixed(2),
                price: price.toFixed(2),
              }),
            }
          );
          console.log(`  linked draft invoice ${label}`);
          stats.linked++;
          openLeft = Math.max(0, openLeft - price);
          invoice.total_unpaid = String(Math.max(0, unpaid - price));
          continue;
        }

        const paymentDate = String(payment.paidAt || "").slice(0, 10) || SINCE;
        const created = await mbFetch(
          `/sales_invoices/${invoice.id}/payments.json`,
          {
            method: "POST",
            body: JSON.stringify({
              payment: {
                payment_date: paymentDate,
                price: price.toFixed(2),
                transaction_identifier: payment.id,
              },
            }),
          }
        );
        stats.registered++;
        await mbFetch(
          `/financial_mutations/${mutation.id}/link_booking.json`,
          {
            method: "PATCH",
            body: JSON.stringify({
              booking_type: "Payment",
              booking_id: String(created.id),
            }),
          }
        );
        console.log(`  registered+linked ${label}`);
        stats.linked++;
        openLeft = Math.max(0, openLeft - price);
        invoice.total_unpaid = String(Math.max(0, unpaid - price));
        invoice.payments = [
          ...(invoice.payments || []),
          {
            id: created.id,
            transaction_identifier: payment.id,
            price: price.toFixed(2),
            financial_mutation_id: mutation.id,
          },
        ];
      } catch (err) {
        stats.errors++;
        console.log(
          `  ! ${payment.id} ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }

  console.log("\n======= SUMMARY =======");
  console.log(stats);
  if (!APPLY) console.log("\nDry-run klaar. Run met --apply om te koppelen.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
