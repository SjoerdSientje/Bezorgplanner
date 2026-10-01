import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PDOK_FREE = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
const PDOK_LOOKUP = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup";

type PdokDoc = {
  id?: string;
  weergavenaam?: string;
  straatnaam?: string;
  huisnummer?: number | string;
  huisletter?: string;
  huisnummertoevoeging?: string;
  postcode?: string;
  woonplaatsnaam?: string;
};

export type PdokAdresSuggestion = {
  id: string;
  label: string;
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
};

function formatPostcode(raw: string | undefined | null): string {
  const p = String(raw ?? "")
    .replace(/\s/g, "")
    .toUpperCase();
  if (/^\d{4}[A-Z]{2}$/.test(p)) return `${p.slice(0, 4)} ${p.slice(4)}`;
  return "";
}

function formatHuisnummer(doc: PdokDoc): string {
  const num = String(doc.huisnummer ?? "").trim();
  const letter = String(doc.huisletter ?? "").trim();
  const toev = String(doc.huisnummertoevoeging ?? "").trim();
  return [num, letter, toev].filter(Boolean).join("");
}

function postcodeFromWeergave(s: string): string {
  const m = String(s ?? "").match(/\b(\d{4}\s*[A-Za-z]{2})\b/i);
  return m ? formatPostcode(m[1]) : "";
}

function buildLabel(parts: {
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  weergavenaam?: string;
}): string {
  const { straatnaam, huisnummer, postcode, woonplaats, weergavenaam } = parts;
  if (straatnaam && postcode) {
    const head = [straatnaam, huisnummer].filter(Boolean).join(" ");
    return `${head}, ${postcode}${woonplaats ? ` ${woonplaats}` : ""}`;
  }
  const weergave = String(weergavenaam ?? "").trim();
  if (weergave) {
    return weergave.replace(
      /\b(\d{4})([A-Za-z]{2})\b/gi,
      (_, n, l) => `${n} ${String(l).toUpperCase()}`
    );
  }
  return [straatnaam, huisnummer, woonplaats].filter(Boolean).join(" ");
}

async function lookupById(id: string): Promise<PdokDoc | null> {
  try {
    const res = await fetch(`${PDOK_LOOKUP}?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: { docs?: PdokDoc[] } };
    return data.response?.docs?.[0] ?? null;
  } catch {
    return null;
  }
}

function mergeDoc(base: PdokDoc, full: PdokDoc | null): PdokDoc {
  if (!full) return base;
  return {
    ...base,
    ...full,
    postcode: full.postcode || base.postcode,
    straatnaam: full.straatnaam || base.straatnaam,
    woonplaatsnaam: full.woonplaatsnaam || base.woonplaatsnaam,
    weergavenaam: full.weergavenaam || base.weergavenaam,
  };
}

function toSuggestion(doc: PdokDoc): PdokAdresSuggestion | null {
  const id = String(doc.id ?? "").trim();
  if (!id) return null;

  const straatnaam = String(doc.straatnaam ?? "").trim();
  const huisnummer = formatHuisnummer(doc);
  let postcode =
    formatPostcode(doc.postcode) || postcodeFromWeergave(doc.weergavenaam ?? "");
  const woonplaats = String(doc.woonplaatsnaam ?? "").trim();

  if (!postcode) return null;

  return {
    id,
    label: buildLabel({
      straatnaam,
      huisnummer,
      postcode,
      woonplaats,
      weergavenaam: doc.weergavenaam,
    }),
    straatnaam,
    huisnummer,
    postcode,
    woonplaats,
  };
}

/**
 * GET /api/pdok/adres?q=...
 * Zoekt NL-adressen via PDOK en geeft alleen treffers mét postcode terug.
 */
export async function GET(request: NextRequest) {
  try {
    const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 3) {
      return NextResponse.json({ suggestions: [] as PdokAdresSuggestion[] });
    }

    const params = new URLSearchParams({
      q,
      fq: "type:adres",
      rows: "8",
      fl: "id,weergavenaam,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam",
    });

    const searchRes = await fetch(`${PDOK_FREE}?${params.toString()}`, {
      cache: "no-store",
    });
    if (!searchRes.ok) {
      return NextResponse.json(
        { error: "PDOK zoeken mislukt.", suggestions: [] },
        { status: 502 }
      );
    }

    const searchData = (await searchRes.json()) as {
      response?: { docs?: PdokDoc[] };
    };
    const docs = searchData.response?.docs ?? [];

    const enriched = await Promise.all(
      docs.map(async (doc) => {
        const hasPc =
          Boolean(formatPostcode(doc.postcode)) ||
          Boolean(postcodeFromWeergave(doc.weergavenaam ?? ""));
        if (hasPc || !doc.id) return doc;
        const full = await lookupById(doc.id);
        return mergeDoc(doc, full);
      })
    );

    const suggestions = enriched
      .map(toSuggestion)
      .filter((s): s is PdokAdresSuggestion => Boolean(s));

    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("[api/pdok/adres]", e);
    return NextResponse.json(
      { error: "Adres zoeken mislukt.", suggestions: [] },
      { status: 500 }
    );
  }
}
