import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchAllOrders } from "@/lib/supabase";
import { getPlanningDate, isDatumOpmerkingVandaagOfMorgen } from "@/lib/planning-date";
import { requireAccountEmail } from "@/lib/account";
import {
  buildRoutificPayload,
  type OrderForRoute,
} from "@/lib/routific-payload";
import { maakTijdslot } from "@/lib/tijdslot";

const ROUTIFIC_VRP_URL = "https://api.routific.com/v1/vrp-long";
const ROUTIFIC_JOBS_URL = "https://api.routific.com/jobs";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000; // 2 min

/**
 * POST /api/routific/route
 * Body: { vertrektijd: "HH:MM" }
 *
 * Haalt orders op (meenemen in planning = ja, datum opmerking vandaag of datum = planningdatum),
 * bouwt Routific-payload (adressen, aantal fietsen, tijdvensters uit bezorgtijd voorkeur),
 * stuurt naar Routific vrp-long (ondersteunt address-geocoding), wacht op resultaat.
 */
export async function POST(request: NextRequest) {
  try {
    const ownerEmail = requireAccountEmail(request);
    const body = await request.json().catch(() => ({}));
    const vertrektijd = (body.vertrektijd ?? "10:30").toString().trim();
    if (!/^\d{1,2}:\d{2}$/.test(vertrektijd)) {
      return NextResponse.json(
        { error: "Ongeldige vertrektijd. Gebruik HH:MM." },
        { status: 400 }
      );
    }
    const busType: "klein" | "groot" = body.busType === "klein" ? "klein" : "groot";

    const token = process.env.ROUTIFIC_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "ROUTIFIC_API_TOKEN niet geconfigureerd." },
        { status: 500 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase niet geconfigureerd." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { date: planningDate } = getPlanningDate();

    // Gebruik fetchAllOrders om row-limit bug te omzeilen, filter daarna in JS
    const allOrders = await fetchAllOrders();
    const rows = (allOrders as unknown as OrderForRoute[]).filter((o) => {
      if (String((o as unknown as Record<string, unknown>).owner_email ?? "") !== ownerEmail) return false;
      if ((o as unknown as Record<string, unknown>).status !== "ritjes_vandaag") return false;
      if (!(o as unknown as Record<string, unknown>).meenemen_in_planning) return false;
      const opmerking = ((o as unknown as Record<string, unknown>).datum_opmerking as string) ?? "";
      const heeftVandaagOfMorgen = isDatumOpmerkingVandaagOfMorgen(opmerking);
      const heeftDatum = ((o as unknown as Record<string, unknown>).datum as string | null) === planningDate;
      return heeftVandaagOfMorgen || heeftDatum;
    });
    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Geen orders om mee te nemen in de route (planningdatum: " + planningDate + ").",
        planningDate,
        vertrektijd,
        visitCount: 0,
      });
    }

    const payload = buildRoutificPayload(rows, vertrektijd, busType);

    const res = await fetch(ROUTIFIC_VRP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[api/routific/route] Routific POST:", res.status, errText);
      return NextResponse.json(
        {
          error:
            "Routific weigert het verzoek. Controleer payload en token.",
          detail: errText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const { job_id } = (await res.json().catch(() => ({}))) as { job_id?: string };
    if (!job_id) {
      return NextResponse.json(
        { error: "Geen job_id van Routific ontvangen." },
        { status: 502 }
      );
    }

    const output = await pollRoutificJob(token, job_id);
    if (typeof output === "string") {
      return NextResponse.json(
        { error: "Routific meldt een fout.", detail: output },
        { status: 502 }
      );
    }

    const solution = output?.solution as Record<string, Array<{ location_id?: string; arrival_time?: string }>> | undefined;
    const vehicleStops = solution?.vehicle_1;
    const sanitizeId = (id: string) => id.replace(/[.$]/g, "_");
    const orderByVisitId = new Map<string, OrderForRoute>();
    for (const o of rows) {
      orderByVisitId.set(o.id, o);
      orderByVisitId.set(sanitizeId(o.id), o);
    }

    if (vehicleStops?.length) {
      const slotsToInsert: { order_id: string; volgorde: number; aankomsttijd: string; tijd_opmerking: string }[] = [];
      let volgorde = 0;
      for (const stop of vehicleStops) {
        const locId = stop.location_id ?? "";
        if (locId === "depot") continue;
        const order = orderByVisitId.get(locId);
        if (!order) continue;
        const arrivalTime = stop.arrival_time ?? "";
        if (!arrivalTime) continue;
        const slotStr = maakTijdslot(arrivalTime, order.bezorgtijd_voorkeur);
        volgorde += 1;
        slotsToInsert.push({
          order_id: order.id,
          volgorde,
          aankomsttijd: slotStr,
          tijd_opmerking: arrivalTime,
        });
      }

      if (slotsToInsert.length > 0) {
        // Schrijf alleen aankomsttijd_slot terug op elke order zodat die zichtbaar
        // is in de "Ritjes voor vandaag" tabel. planning_slots worden pas aangemaakt
        // bij "Planning goedkeuren" — zo verschijnen ze niet vroegtijdig in Planning.
        for (const s of slotsToInsert) {
          await supabase
            .from("orders")
            .update({ aankomsttijd_slot: s.aankomsttijd })
            .eq("owner_email", ownerEmail)
            .eq("id", s.order_id);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Route berekend en tijdsloten opgeslagen.",
      planningDate,
      vertrektijd,
      visitCount: rows.length,
      job_id,
      solution: output?.solution ?? null,
      unserved: output?.unserved ?? null,
    });
  } catch (e) {
    console.error("[api/routific/route]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function pollRoutificJob(
  token: string,
  jobId: string
): Promise<Record<string, unknown> | string> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(`${ROUTIFIC_JOBS_URL}/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Routific job status failed: ${res.status} ${t}`);
    }
    const data = (await res.json()) as {
      status?: string;
      output?: Record<string, unknown> | string;
    };
    if (data.status === "finished" && data.output != null) {
      return typeof data.output === "string"
        ? data.output
        : (data.output as Record<string, unknown>);
    }
    if (data.status === "error" && data.output != null) {
      return typeof data.output === "string"
        ? data.output
        : JSON.stringify(data.output);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Routific job timeout.");
}
