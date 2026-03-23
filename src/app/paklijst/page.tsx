"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import Header from "@/components/Header";

interface LineItem {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
  defaultItems?: string[];
}

interface OrderDetail {
  id: string;
  order_nummer: string | number | null;
  naam: string | null;
  volledig_adres: string | null;
  aankomsttijd_slot: string | null;
  products: LineItem[];
}

interface PaklijstItem {
  name: string;
  count: number;
}

interface PaklijstData {
  orders: OrderDetail[];
  items: PaklijstItem[];
  orderCount: number;
  generatedAt: string;
}

// Eigenschappen die alleen als label dienen en niet apart hoeven op te vallen
const LABEL_PROPERTIES = new Set(["levering", "kleur", "maat", "type"]);

function ProductBlok({ item }: { item: LineItem }) {
  if (item.isFiets) {
    const zichtbareProps = item.properties.filter(
      (p) => !LABEL_PROPERTIES.has(p.name.toLowerCase())
    );
    const leveringProp = item.properties.find(
      (p) => p.name.toLowerCase() === "levering"
    );

    return (
      <div className="rounded-xl border border-koopje-orange/30 bg-orange-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🚲</span>
            <span className="text-sm font-semibold text-koopje-black">{item.name}</span>
          </div>
          {leveringProp && (
            <span className="shrink-0 rounded-full bg-koopje-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-koopje-orange">
              {leveringProp.value}
            </span>
          )}
        </div>

        {/* Extra eigenschappen (achterzitje gemonteerd, voorrekje, etc.) */}
        {zichtbareProps.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 pl-7">
            {zichtbareProps.map((p, i) => (
              <li key={i} className="text-xs text-stone-600">
                <span className="font-medium">{p.name}:</span> {p.value}
              </li>
            ))}
          </ul>
        )}

        {/* Standaard inbegrepen items */}
        {(item.defaultItems ?? []).length > 0 && (
          <ul className="mt-1.5 space-y-0.5 pl-7">
            {(item.defaultItems ?? []).map((d, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs text-stone-500">
                <span className="h-1 w-1 shrink-0 rounded-full bg-stone-400" />
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Gewoon accessoire / los product
  return (
    <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2">
      <span className="text-sm text-stone-700">{item.name}</span>
      {item.price > 0 && (
        <span className="shrink-0 text-xs font-medium text-stone-400">
          €{item.price.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function OrderBlok({ order, index }: { order: OrderDetail; index: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 bg-stone-50 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-koopje-orange text-[10px] font-bold text-white">
              {index + 1}
            </span>
            <span className="text-sm font-semibold text-koopje-black">
              {order.naam ?? "—"}
            </span>
            {order.order_nummer && (
              <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-mono text-stone-500">
                #{order.order_nummer}
              </span>
            )}
          </div>
          {order.volledig_adres && (
            <p className="mt-0.5 pl-7 text-xs text-stone-500">{order.volledig_adres}</p>
          )}
        </div>
        {order.aankomsttijd_slot && (
          <span className="shrink-0 rounded-full border border-koopje-orange/30 bg-koopje-orange-light px-3 py-1 text-xs font-semibold text-koopje-orange">
            {order.aankomsttijd_slot}
          </span>
        )}
      </div>

      {/* Producten */}
      <div className="space-y-2 p-4">
        {order.products.length === 0 ? (
          <p className="text-xs text-stone-400">Geen producten</p>
        ) : (
          order.products.map((item, i) => <ProductBlok key={i} item={item} />)
        )}
      </div>
    </div>
  );
}

export default function PaklijstPage() {
  const [data, setData] = useState<PaklijstData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const genereer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/paklijst?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Ophalen mislukt");
      const json = await res.json();
      setData(json);
    } catch {
      setError("Er ging iets mis bij het genereren.");
    } finally {
      setLoading(false);
    }
  }, []);

  const formatTijd = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  const formatDatum = () =>
    new Date().toLocaleDateString("nl-NL", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">

          {/* Topbalk */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-koopje-black/60 transition hover:text-koopje-black"
                aria-label="Terug naar dashboard"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Paklijst</h1>
                <p className="text-sm text-koopje-black/50 capitalize">{formatDatum()}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={genereer}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-koopje-orange px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-koopje-orange/90 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Genereren…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Paklijst genereren
                </>
              )}
            </button>
          </div>

          {/* Foutmelding */}
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Lege staat */}
          {!data && !loading && !error && (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200 py-20 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-koopje-orange-light text-koopje-orange">
                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="font-medium text-koopje-black">Nog geen paklijst</p>
              <p className="mt-1 text-sm text-koopje-black/50">
                Klik op &lsquo;Paklijst genereren&rsquo; om de lijst op te bouwen
              </p>
            </div>
          )}

          {/* Gegenereerde paklijst */}
          {data && (
            <div className="space-y-10">

              {/* Meta-balk */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-koopje-orange-light px-3 py-1 text-xs font-semibold text-koopje-orange">
                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {data.orderCount} {data.orderCount === 1 ? "order" : "orders"} meegenomen
                </span>
                <span className="text-xs text-koopje-black/40">
                  Gegenereerd om {formatTijd(data.generatedAt)}
                </span>
                <button
                  type="button"
                  onClick={genereer}
                  disabled={loading}
                  className="ml-auto text-xs font-medium text-koopje-orange hover:underline disabled:opacity-50"
                >
                  Opnieuw genereren
                </button>
              </div>

              {/* ── Sectie 1: Per order ── */}
              <section>
                <h2 className="mb-4 text-base font-semibold text-koopje-black">
                  Overzicht per order
                </h2>
                {data.orders.length === 0 ? (
                  <p className="text-sm text-stone-400">Geen orders gevonden.</p>
                ) : (
                  <div className="space-y-4">
                    {data.orders.map((order, i) => (
                      <OrderBlok key={order.id} order={order} index={i} />
                    ))}
                  </div>
                )}
              </section>

              {/* Scheidingslijn */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-stone-200" />
                <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-stone-400">
                  Samenvattende paklijst
                </span>
                <div className="h-px flex-1 bg-stone-200" />
              </div>

              {/* ── Sectie 2: Samenvattende paklijst ── */}
              <section>
                <h2 className="mb-4 text-base font-semibold text-koopje-black">
                  Totaal mee te nemen
                </h2>
                {data.items.length === 0 ? (
                  <div className="rounded-xl border border-stone-200 bg-stone-50 px-5 py-8 text-center text-sm text-stone-500">
                    Geen accessoires gevonden voor de orders van vandaag.
                    <br />
                    <span className="text-xs text-stone-400">
                      Controleer of orders &apos;meenemen in planning&apos; aan hebben staan
                      en datum opmerking &apos;vandaag&apos; is.
                    </span>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm">
                    <div className="flex items-center justify-between border-b border-stone-200 bg-stone-100 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      <span>Product</span>
                      <span>Aantal</span>
                    </div>
                    <ul className="divide-y divide-stone-100 bg-white">
                      {data.items.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between px-5 py-3 transition hover:bg-stone-50"
                        >
                          <span className="text-sm font-medium text-koopje-black">{item.name}</span>
                          <span className="ml-4 shrink-0 rounded-full bg-koopje-orange-light px-3 py-0.5 text-sm font-bold text-koopje-orange">
                            {item.count}×
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-stone-200 bg-stone-50 px-5 py-3 text-right text-xs text-stone-500">
                      {data.items.reduce((s, i) => s + i.count, 0)} producten in totaal ·{" "}
                      {data.items.length} unieke artikelen
                    </div>
                  </div>
                )}
              </section>

            </div>
          )}
        </div>
      </main>
    </>
  );
}
