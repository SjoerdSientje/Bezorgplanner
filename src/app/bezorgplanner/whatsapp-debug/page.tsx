"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";

type DebugOrder = {
  id: string;
  order_nummer: string | null;
  naam: string | null;
  type: string | null;
  inferred_kind: string;
  aankomsttijd_slot: string | null;
  telefoon: string | null;
  templates: Record<
    "planning_goedgekeurd" | "stuur_appjes" | "afronden",
    { name: string | null; language: string | null }
  >;
};

export default function WhatsAppDebugPage() {
  const [orders, setOrders] = useState<DebugOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp-debug?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Ophalen mislukt");
      setOrders((data.orders ?? []) as DebugOrder[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ophalen mislukt");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-12">
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
              <div>
                <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
                  WhatsApp Template Debug
                </h1>
                <p className="text-sm text-koopje-black/60">
                  Controleer per ordertype welke template per flow gekozen wordt.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-lg border border-koopje-black/20 bg-white px-4 py-2 text-sm font-medium text-koopje-black hover:bg-koopje-black/5 disabled:opacity-50"
            >
              {loading ? "Laden…" : "Verversen"}
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-stone-200">
            <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-stone-100">
                  <th className="border border-stone-200 px-3 py-2">Order</th>
                  <th className="border border-stone-200 px-3 py-2">Naam</th>
                  <th className="border border-stone-200 px-3 py-2">Type</th>
                  <th className="border border-stone-200 px-3 py-2">Kind</th>
                  <th className="border border-stone-200 px-3 py-2">Tijdslot</th>
                  <th className="border border-stone-200 px-3 py-2">Telefoon</th>
                  <th className="border border-stone-200 px-3 py-2">Planning goedgekeurd</th>
                  <th className="border border-stone-200 px-3 py-2">Stuur appjes</th>
                  <th className="border border-stone-200 px-3 py-2">Afronden</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-stone-50">
                    <td className="border border-stone-200 px-3 py-2 font-mono text-xs">{o.order_nummer ?? "-"}</td>
                    <td className="border border-stone-200 px-3 py-2">{o.naam ?? "-"}</td>
                    <td className="border border-stone-200 px-3 py-2">{o.type ?? "-"}</td>
                    <td className="border border-stone-200 px-3 py-2">{o.inferred_kind}</td>
                    <td className="border border-stone-200 px-3 py-2">{o.aankomsttijd_slot ?? "-"}</td>
                    <td className="border border-stone-200 px-3 py-2">{o.telefoon ?? "-"}</td>
                    <td className="border border-stone-200 px-3 py-2">
                      {o.templates.planning_goedgekeurd.name ? (
                        <span>
                          {o.templates.planning_goedgekeurd.name} ({o.templates.planning_goedgekeurd.language})
                        </span>
                      ) : (
                        <span className="text-red-500">Geen mapping</span>
                      )}
                    </td>
                    <td className="border border-stone-200 px-3 py-2">
                      {o.templates.stuur_appjes.name ? (
                        <span>
                          {o.templates.stuur_appjes.name} ({o.templates.stuur_appjes.language})
                        </span>
                      ) : (
                        <span className="text-red-500">Geen mapping</span>
                      )}
                    </td>
                    <td className="border border-stone-200 px-3 py-2">
                      {o.templates.afronden.name ? (
                        <span>
                          {o.templates.afronden.name} ({o.templates.afronden.language})
                        </span>
                      ) : (
                        <span className="text-red-500">Geen mapping</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && orders.length === 0 && (
                  <tr>
                    <td colSpan={9} className="border border-stone-200 px-3 py-8 text-center text-stone-500">
                      Geen orders gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}

