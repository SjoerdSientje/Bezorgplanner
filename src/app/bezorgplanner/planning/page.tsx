"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import Link from "next/link";
import Header from "@/components/Header";

const PLANNING_HEADERS = [
  "Order nummer",
  "Naam",
  "Aankomsttijd",
  "Tijd opmerking",
  "Adress URL",
  "Bel link",
  "Bestelling Totaal Prijs",
  "Betaald?",
  "Aantal fietsen",
  "Product(en)",
  "Opmerking klant",
  "Volledig adress",
  "Ingevuld Telefoon nummer",
  "Order Nummer",
  "Email",
  "Link Aankoopbewijs",
];

type PlanningRow = {
  slot_id: string;
  order_id: string;
  datum: string;
  order_nummer: string;
  naam: string;
  aankomsttijd: string;
  tijd_opmerking: string;
  adres_url: string;
  bel_link: string;
  bestelling_totaal_prijs: string | number;
  betaald: string | boolean;
  aantal_fietsen: string | number;
  producten: string;
  opmerking_klant: string;
  volledig_adres: string;
  telefoon_nummer: string;
  email: string;
  link_aankoopbewijs: string;
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "ja" : "nee";
  return String(value);
}

function normalizeToE164(input: string): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const compact = s.replace(/[()\s-]/g, "");
  if (!compact) return null;
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("0")) return `+31${compact.slice(1)}`;
  if (/^\d{8,15}$/.test(compact)) return `+${compact}`;
  return null;
}

function extractPhoneFromBelLink(value: string): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.toLowerCase().startsWith("tel:")) return normalizeToE164(v.slice(4));
  try {
    const url = new URL(v);
    if (url.hostname.toLowerCase().includes("call.ctrlq.org")) {
      const path = url.pathname.replace(/^\//, "");
      return normalizeToE164(path);
    }
  } catch {
    // ignore
  }
  const plusMatch = v.match(/(\+\d{8,15})/);
  if (plusMatch) return plusMatch[1];
  return normalizeToE164(v);
}

function PlanningTabel({ rows, label, labelColor }: { rows: PlanningRow[]; label: string; labelColor: string }) {
  return (
    <div className="mb-8">
      <h2 className={`mb-3 text-base font-semibold ${labelColor}`}>{label}</h2>
      <div className="overflow-x-auto rounded-xl border-2 border-stone-300 bg-white shadow-sm">
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <thead>
            <tr className="bg-stone-100">
              {PLANNING_HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap border border-stone-300 px-2 py-2 font-medium text-stone-800">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={PLANNING_HEADERS.length} className="border border-stone-300 px-2 py-4 text-center text-koopje-black/60">
                  Geen ritjes.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.slot_id}>
                  <td className="min-w-[4rem] border border-stone-300 p-0 align-top">
                    <Link
                      href={`/bezorgplanner/afronden/${row.order_id}`}
                      className="block px-2 py-1.5 text-koopje-orange underline decoration-koopje-orange underline-offset-2 hover:text-koopje-orange-dark"
                    >
                      {formatCell(row.order_nummer)} afronden
                    </Link>
                  </td>
                  {/* Naam */} 
                  <td className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700">{formatCell(row.naam)}</td>
                  {/* Aankomsttijd */} 
                  <td className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700">{formatCell(row.aankomsttijd)}</td>
                  {/* Tijd opmerking */} 
                  <td className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700">{formatCell(row.tijd_opmerking)}</td>
                  {/* Adress URL */} 
                  <td className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700">
                    {row.adres_url ? (
                      <a href={row.adres_url} target="_blank" rel="noopener noreferrer" className="text-koopje-orange underline underline-offset-2">
                        📍 Kaart
                      </a>
                    ) : (
                      ""
                    )}
                  </td>
                  {/* Bel link */} 
                  <td className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700">
                    {(() => {
                      const phone =
                        normalizeToE164(row.telefoon_nummer) ?? extractPhoneFromBelLink(row.bel_link);
                      return phone ? (
                        <a href={`tel:${phone}`} className="text-koopje-orange underline underline-offset-2">
                          📞 Bellen
                        </a>
                      ) : (
                        ""
                      );
                    })()}
                  </td>
                  {/* Rest */} 
                  {[
                    row.bestelling_totaal_prijs,
                    row.betaald,
                    row.aantal_fietsen,
                    row.producten,
                    row.opmerking_klant,
                    row.volledig_adres,
                    row.telefoon_nummer,
                    row.order_nummer,
                    row.email,
                    row.link_aankoopbewijs,
                  ].map((v, i) => (
                    <td key={i} className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700">
                      {formatCell(v)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PlanningPage() {
  const [rows, setRows] = useState<PlanningRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlanning = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/planning?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlanning();
  }, [fetchPlanning]);

  // Groepeer op datum; eerste (vroegste) datum = vandaag / actief, volgende = morgen
  const grouped = useMemo(() => {
    const map = new Map<string, PlanningRow[]>();
    for (const r of rows) {
      const key = r.datum ?? "onbekend";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted;
  }, [rows]);

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link
                href="/bezorgplanner"
                className="text-koopje-black/60 transition hover:text-koopje-black"
                aria-label="Terug"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Planning</h1>
            </div>
            <button
              type="button"
              onClick={fetchPlanning}
              className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-xs text-koopje-black/60 transition hover:border-koopje-orange hover:text-koopje-orange"
            >
              Verversen
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-koopje-black/60">
              Geen planning. Keur eerst de planning goed op Ritjes voor vandaag.
            </p>
          ) : (
            grouped.map(([datum, datumRows], idx) => (
              <PlanningTabel
                key={datum}
                rows={datumRows}
                label={
                  idx === 0
                    ? `Huidige planning — ${datum}`
                    : `Ritjes voor morgen — ${datum}`
                }
                labelColor={
                  idx === 0 ? "text-koopje-black" : "text-koopje-orange"
                }
              />
            ))
          )}
        </div>
      </main>
    </>
  );
}
