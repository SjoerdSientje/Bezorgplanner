/**
 * Debug-script: reproduceert de exacte /api/routific/route-logica lokaal met de
 * echte productiecode (geen re-implementatie), om te zien wat Routific écht
 * teruggeeft (inclusief unserved-redenen) voor de huidige Lijst Sjoerd-batch.
 *
 * Run met: npx tsx scripts/debug-routific.ts
 */
import {
  buildRoutificPayloadFromRoutes,
  orderRouteLoad,
  type OrderForRoute,
  type ParallelRouteSpec,
} from "@/lib/routific-payload";
import { geocodeOrdersForRouting } from "@/lib/pdok-geocode";

const OWNER_EMAIL = "info@koopjefatbike.nl";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = process.env.ROUTIFIC_API_TOKEN!;

  const [ordersRes, slotsRes] = await Promise.all([
    fetch(
      `${url}/rest/v1/orders?select=*&status=eq.ritjes_vandaag&meenemen_in_planning=eq.true&owner_email=eq.${encodeURIComponent(OWNER_EMAIL)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    ).then((r) => r.json()),
    fetch(
      `${url}/rest/v1/planning_slots?select=order_id&owner_email=eq.${encodeURIComponent(OWNER_EMAIL)}&status=not.eq.afgerond`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    ).then((r) => r.json()),
  ]);

  const activeSlotIds = new Set((slotsRes as { order_id: string }[]).map((s) => s.order_id));
  const rows = (ordersRes as Record<string, unknown>[]).filter(
    (o) => !activeSlotIds.has(String(o.id))
  ) as unknown as OrderForRoute[];

  console.log(`Lijst Sjoerd batch: ${rows.length} orders`);
  for (const o of rows) {
    console.log(`  - ${o.naam} (${o.id}) fietsen=${o.aantal_fietsen} load=${orderRouteLoad(o)} adres="${o.volledig_adres}"`);
  }

  // Pas hieronder aan naar de exacte huidige configuratie in de UI-dialoog.
  const route1PinNames = ["Isabel Severenes", "Anna Rogalewski", "Richard Pertijs"];
  const route1Pins = rows.filter((o) => route1PinNames.includes(String(o.naam))).map((o) => o.id);
  console.log("\nRoute 1 pins gevonden:", route1Pins.length, route1Pins);

  const parallelRoutes: ParallelRouteSpec[] = [
    { shift_start: "13:00", capacity: 3, orderIds: route1Pins },
    { shift_start: "13:00", capacity: 11 },
  ];

  console.log("\nGeocoderen...");
  const geocoded = await geocodeOrdersForRouting(rows);
  const missingGeo = geocoded.filter((o) => o.lat == null || o.lng == null);
  if (missingGeo.length > 0) {
    console.log("\n⚠️  Orders ZONDER geocode-resultaat (val terug op tekstadres voor Routific):");
    for (const o of missingGeo) console.log(`  - ${o.naam}: "${o.volledig_adres}"`);
  }

  const payload = buildRoutificPayloadFromRoutes(geocoded, parallelRoutes);
  console.log("\n--- Routific payload (visits) ---");
  console.log(JSON.stringify(payload.visits, null, 2));
  console.log("\n--- Routific payload (fleet) ---");
  console.log(JSON.stringify(payload.fleet, null, 2));

  console.log("\nVerzenden naar Routific...");
  const res = await fetch("https://api.routific.com/v1/vrp-long", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("Routific POST fout:", res.status, await res.text());
    return;
  }
  const { job_id } = (await res.json()) as { job_id?: string };
  console.log("job_id:", job_id);

  const start = Date.now();
  while (Date.now() - start < 120000) {
    const jobRes = await fetch(`https://api.routific.com/jobs/${job_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const jobData = (await jobRes.json()) as {
      status?: string;
      output?: Record<string, unknown> | string;
    };
    if (jobData.status === "finished" && jobData.output != null) {
      const output = jobData.output as Record<string, unknown>;
      console.log("\n=== SOLUTION ===");
      console.log(JSON.stringify(output.solution, null, 2));
      console.log("\n=== UNSERVED ===");
      console.log(JSON.stringify(output.unserved, null, 2));
      return;
    }
    if (jobData.status === "error") {
      console.error("Routific job error:", jobData.output);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error("Timeout.");
}

main().catch((e) => console.error(e));
