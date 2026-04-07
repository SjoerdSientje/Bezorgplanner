"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";

type PakketjesOrderItem = { name: string; quantity: number };
type PakketjesOrder = {
  id: string;
  shopify_order_id: string;
  order_nummer: string;
  naam: string;
  adres: string;
  totaal_prijs: number;
  fulfillment_status: string;
  items: PakketjesOrderItem[];
};
type PakketjesResponse = {
  orders: PakketjesOrder[];
  summary: { name: string; count: number }[];
  count: number;
  generatedAt: string;
};

export default function PakketjesPaklijstPage() {
  const [loading, setLoading] = useState(true);
  const [busyAfgerond, setBusyAfgerond] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PakketjesResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/paklijst/pakketjes?t=${Date.now()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Partial<PakketjesResponse> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Laden mislukt");
      setData(json as PakketjesResponse);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pakketjesAfgerond() {
    if (
      !window.confirm(
        "Alle pakketjes voor dit account wissen? Alleen nieuwe orders vanaf nu komen weer op de lijst (via Shopify-webhook)."
      )
    ) {
      return;
    }
    setBusyAfgerond(true);
    setError(null);
    try {
      const res = await fetch("/api/paklijst/pakketjes/afgerond", {
        method: "POST",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Afronden mislukt");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afronden mislukt");
    } finally {
      setBusyAfgerond(false);
    }
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/paklijst-keuze" className="text-koopje-black/60 transition hover:text-koopje-black" aria-label="Terug">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Paklijst Pakketjes</h1>
                <p className="text-sm text-koopje-black/60">
                  Orders onder €500 komen automatisch binnen via de Shopify-webhook
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-koopje-black shadow-sm transition hover:bg-stone-50 disabled:opacity-60"
              >
                {loading ? "Laden…" : "Vernieuwen"}
              </button>
              <button
                type="button"
                onClick={() => void pakketjesAfgerond()}
                disabled={loading || busyAfgerond}
                className="rounded-xl bg-stone-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-700 disabled:opacity-60"
              >
                {busyAfgerond ? "Bezig…" : "Pakketjes afgerond"}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="rounded-2xl border border-stone-200 py-16 text-center text-sm text-stone-500">Laden…</div>
          )}

          {!loading && data && (
            <div className="space-y-6">
              <p className="text-sm text-stone-500">
                {data.count} orders · bijgewerkt {new Date(data.generatedAt).toLocaleString("nl-NL")}
              </p>

              {data.orders.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-stone-200 py-16 text-center text-sm text-stone-500">
                  Nog geen pakketjes in de wachtrij. Nieuwe Shopify-orders onder €500 verschijnen hier automatisch.
                </div>
              ) : (
                <div className="space-y-4">
                  {data.orders.map((o, idx) => (
                    <div key={o.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-koopje-orange text-[10px] font-bold text-white">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-koopje-black">{o.naam || "—"}</span>
                          <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{o.order_nummer}</span>
                        </div>
                        <span className="text-sm font-semibold text-koopje-black">€{o.totaal_prijs.toFixed(2)}</span>
                      </div>
                      <p className="mb-3 whitespace-pre-wrap text-sm text-stone-600">{o.adres || "Geen adres"}</p>
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
              )}

              <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-koopje-black">Totaal producten</h2>
                {!data.summary?.length ? (
                  <p className="text-sm text-stone-500">Geen producten in de wachtrij.</p>
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
