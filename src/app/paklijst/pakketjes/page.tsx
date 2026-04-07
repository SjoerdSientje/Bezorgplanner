"use client";

import { useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";

type PakketjesOrderItem = { name: string; quantity: number };
type PakketjesOrder = {
  id: string;
  order_nummer: string;
  naam: string;
  adres: string;
  totaal_prijs: number;
  items: PakketjesOrderItem[];
};
type PakketjesResponse = {
  orders: PakketjesOrder[];
  summary: { name: string; count: number }[];
  count: number;
  generatedAt: string;
};

export default function PakketjesPaklijstPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PakketjesResponse | null>(null);

  async function genereer() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/paklijst/pakketjes?t=${Date.now()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Partial<PakketjesResponse> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Genereren mislukt");
      setData(json as PakketjesResponse);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Genereren mislukt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/paklijst-keuze" className="text-koopje-black/60 transition hover:text-koopje-black" aria-label="Terug">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Paklijst Pakketjes</h1>
                <p className="text-sm text-koopje-black/60">
                  Shopify openstaande orders &lt; €500
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={genereer}
              disabled={loading}
              className="rounded-xl bg-koopje-orange px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-koopje-orange/90 disabled:opacity-60"
            >
              {loading ? "Genereren…" : "Genereer paklijst"}
            </button>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!data && !loading && !error && (
            <div className="rounded-2xl border-2 border-dashed border-stone-200 py-16 text-center text-sm text-stone-500">
              Klik op <strong>Genereer paklijst</strong> om pakketjes op te halen.
            </div>
          )}

          {data && (
            <div className="space-y-6">
              <p className="text-sm text-stone-500">
                {data.count} orders · gegenereerd op {new Date(data.generatedAt).toLocaleString("nl-NL")}
              </p>

              <div className="space-y-4">
                {data.orders.map((o, idx) => (
                  <div key={o.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-koopje-orange text-[10px] font-bold text-white">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-koopje-black">{o.naam || "—"}</span>
                        <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{o.order_nummer}</span>
                      </div>
                      <span className="text-sm font-semibold text-koopje-black">€{o.totaal_prijs.toFixed(2)}</span>
                    </div>
                    <p className="mb-3 text-sm text-stone-600">{o.adres || "Geen adres"}</p>
                    <ul className="space-y-1">
                      {o.items.map((it, i) => (
                        <li key={`${it.name}-${i}`} className="text-sm text-stone-700">
                          {it.quantity}x {it.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-koopje-black">Totaal producten</h2>
                {data.summary.length === 0 ? (
                  <p className="text-sm text-stone-500">Geen producten gevonden.</p>
                ) : (
                  <ul className="space-y-1">
                    {data.summary.map((s) => (
                      <li key={s.name} className="text-sm text-stone-700">
                        {s.count}x {s.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

