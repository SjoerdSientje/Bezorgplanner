"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import KlantBronBadges from "@/components/KlantBronBadges";
import type { Klant } from "@/lib/klanten-shared";
import {
  formatKlantOrderPrijs,
  type KlantOrderHistorieDetail,
} from "@/lib/klant-orderhistorie-shared";

const DEBOUNCE_MS = 280;

type TabId = "gegevens" | "ordergeschiedenis";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-koopje-black">
        {value.trim() ? value : "—"}
      </dd>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-koopje-orange text-koopje-black"
          : "border-transparent text-koopje-black/45 hover:text-koopje-black"
      }`}
    >
      {children}
    </button>
  );
}

export default function KlantenClient() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Klant[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Klant | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("gegevens");
  const [orders, setOrders] = useState<KlantOrderHistorieDetail[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [ordersLoadedFor, setOrdersLoadedFor] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchGenRef = useRef(0);
  const detailGenRef = useRef(0);
  const ordersGenRef = useRef(0);

  function fetchList(q: string) {
    const gen = ++fetchGenRef.current;
    setLoadingList(true);
    setListError(null);
    fetch(`/api/klanten?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Laden mislukt.");
        return data as { customers?: Klant[] };
      })
      .then((data) => {
        if (gen !== fetchGenRef.current) return;
        setCustomers(Array.isArray(data.customers) ? data.customers : []);
      })
      .catch((e) => {
        if (gen !== fetchGenRef.current) return;
        setCustomers([]);
        setListError(e instanceof Error ? e.message : "Laden mislukt.");
      })
      .finally(() => {
        if (gen === fetchGenRef.current) setLoadingList(false);
      });
  }

  function scheduleFetch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchList(q), DEBOUNCE_MS);
  }

  useEffect(() => {
    fetchList("");
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setDetailError(null);
      setOrders([]);
      setOrdersError(null);
      setOrdersLoadedFor(null);
      setOpenOrderId(null);
      return;
    }
    const gen = ++detailGenRef.current;
    setLoadingDetail(true);
    setDetailError(null);
    setOrders([]);
    setOrdersError(null);
    setOrdersLoadedFor(null);
    setOpenOrderId(null);
    fetch(`/api/klanten/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Klant niet gevonden.");
        return data as { customer?: Klant };
      })
      .then((data) => {
        if (gen !== detailGenRef.current) return;
        setSelected(data.customer ?? null);
        setTab("gegevens");
      })
      .catch((e) => {
        if (gen !== detailGenRef.current) return;
        setSelected(null);
        setDetailError(e instanceof Error ? e.message : "Laden mislukt.");
      })
      .finally(() => {
        if (gen === detailGenRef.current) setLoadingDetail(false);
      });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || tab !== "ordergeschiedenis") return;
    if (ordersLoadedFor === selectedId) return;

    const gen = ++ordersGenRef.current;
    setLoadingOrders(true);
    setOrdersError(null);
    fetch(`/api/klanten/${encodeURIComponent(selectedId)}/orders`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Orders laden mislukt.");
        return data as { orders?: KlantOrderHistorieDetail[] };
      })
      .then((data) => {
        if (gen !== ordersGenRef.current) return;
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        setOrdersLoadedFor(selectedId);
        setOpenOrderId(null);
      })
      .catch((e) => {
        if (gen !== ordersGenRef.current) return;
        setOrders([]);
        setOrdersError(e instanceof Error ? e.message : "Orders laden mislukt.");
      })
      .finally(() => {
        if (gen === ordersGenRef.current) setLoadingOrders(false);
      });
  }, [selectedId, tab, ordersLoadedFor]);

  const adresRegel = selected
    ? [
        [selected.straatnaam, selected.huisnummer].filter(Boolean).join(" "),
        [selected.postcode, selected.woonplaats].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const openOrder = openOrderId
    ? orders.find((o) => o.id === openOrderId) ?? null
    : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 flex items-center gap-4">
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
          <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Klanten</h1>
          <p className="mt-0.5 text-sm text-koopje-black/60">
            Moneybird- en Marktplaats-klanten op één plek.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="min-w-0">
          <label className="block text-sm font-medium text-koopje-black">
            Zoeken
            <input
              type="search"
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                scheduleFetch(next);
              }}
              placeholder="Voornaam, achternaam of e-mail…"
              className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
            />
          </label>

          {listError && (
            <p className="mt-3 text-sm text-red-600">{listError}</p>
          )}

          <ul className="mt-4 divide-y divide-koopje-black/8 rounded-xl border border-koopje-black/10 bg-white">
            {loadingList && customers.length === 0 && (
              <li className="px-4 py-6 text-sm text-koopje-black/50">Laden…</li>
            )}
            {!loadingList && customers.length === 0 && (
              <li className="px-4 py-6 text-sm text-koopje-black/50">
                Geen klanten gevonden.
              </li>
            )}
            {customers.map((k) => {
              const active = k.id === selectedId;
              return (
                <li key={k.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(k.id)}
                    className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition ${
                      active
                        ? "bg-koopje-orange-light"
                        : "hover:bg-stone-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-koopje-black">
                        {k.naam || k.email || "Onbekend"}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-koopje-black/50">
                        {k.email || k.telefoon || "—"}
                      </span>
                    </span>
                    <KlantBronBadges
                      moneybird={k.bronnen.moneybird}
                      mp={k.bronnen.mp}
                      snelstart={k.bronnen.snelstart}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
          {loadingList && customers.length > 0 && (
            <p className="mt-2 text-xs text-koopje-black/40">Bijwerken…</p>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-koopje-black/10 bg-white">
          {!selectedId && (
            <div className="flex h-full min-h-[240px] items-center justify-center px-6 text-sm text-koopje-black/45">
              Kies een klant om gegevens te bekijken.
            </div>
          )}

          {selectedId && loadingDetail && !selected && (
            <div className="flex h-full min-h-[240px] items-center justify-center px-6 text-sm text-koopje-black/45">
              Laden…
            </div>
          )}

          {selectedId && detailError && (
            <div className="px-6 py-8 text-sm text-red-600">{detailError}</div>
          )}

          {selected && (
            <div className="flex h-full flex-col">
              <div className="border-b border-koopje-black/10 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-koopje-black">
                      {selected.naam || selected.email || "Klant"}
                    </h2>
                    {selected.email && (
                      <p className="mt-0.5 text-sm text-koopje-black/55">
                        {selected.email}
                      </p>
                    )}
                  </div>
                  <KlantBronBadges
                    moneybird={selected.bronnen.moneybird}
                    mp={selected.bronnen.mp}
                    snelstart={selected.bronnen.snelstart}
                  />
                </div>

                <div className="mt-4 flex gap-1">
                  <TabButton
                    active={tab === "gegevens"}
                    onClick={() => {
                      setTab("gegevens");
                      setOpenOrderId(null);
                    }}
                  >
                    Gegevens
                  </TabButton>
                  <TabButton
                    active={tab === "ordergeschiedenis"}
                    onClick={() => setTab("ordergeschiedenis")}
                  >
                    Ordergeschiedenis
                  </TabButton>
                </div>
              </div>

              {tab === "gegevens" && (
                <dl className="grid gap-5 px-5 py-5 sm:grid-cols-2 sm:px-6 sm:py-6">
                  <Field label="Naam" value={selected.naam} />
                  <Field label="E-mail" value={selected.email} />
                  <Field label="Telefoon" value={selected.telefoon} />
                  <Field label="Adres" value={adresRegel} />
                  <Field label="Straat" value={selected.straatnaam} />
                  <Field label="Huisnummer" value={selected.huisnummer} />
                  <Field label="Postcode" value={selected.postcode} />
                  <Field label="Woonplaats" value={selected.woonplaats} />
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                      Bron
                    </dt>
                    <dd className="mt-2 flex flex-wrap items-center gap-2 text-sm text-koopje-black">
                      {selected.bronnen.moneybird && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-50 px-2.5 py-1">
                          <KlantBronBadges moneybird mp={false} snelstart={false} />
                          Moneybird
                        </span>
                      )}
                      {selected.bronnen.snelstart && !selected.bronnen.moneybird && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-50 px-2.5 py-1">
                          <KlantBronBadges moneybird={false} mp={false} snelstart />
                          Snelstart
                        </span>
                      )}
                      {selected.bronnen.mp && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-50 px-2.5 py-1">
                          <KlantBronBadges moneybird={false} mp snelstart={false} />
                          Marktplaats
                        </span>
                      )}
                      {!selected.bronnen.moneybird &&
                        !selected.bronnen.mp &&
                        !selected.bronnen.snelstart && (
                        <span>—</span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}

              {tab === "ordergeschiedenis" && (
                <div className="px-5 py-5 sm:px-6 sm:py-6">
                  {!selected.email && (
                    <p className="text-sm text-koopje-black/50">
                      Geen e-mailadres — ordergeschiedenis kan niet gekoppeld worden.
                    </p>
                  )}

                  {selected.email && loadingOrders && (
                    <p className="text-sm text-koopje-black/50">Orders laden…</p>
                  )}

                  {ordersError && (
                    <p className="text-sm text-red-600">{ordersError}</p>
                  )}

                  {selected.email && !loadingOrders && !ordersError && orders.length === 0 && (
                    <p className="text-sm text-koopje-black/50">
                      Nog geen afgeronde orders voor deze klant.
                    </p>
                  )}

                  {selected.email && !loadingOrders && orders.length > 0 && !openOrder && (
                    <ul className="divide-y divide-koopje-black/8 rounded-xl border border-koopje-black/10">
                      {orders.map((order) => (
                        <li key={order.id}>
                          <button
                            type="button"
                            onClick={() => setOpenOrderId(order.id)}
                            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-stone-50"
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-koopje-black">
                                {order.typeLabel}
                              </span>
                              <span className="mt-0.5 block text-xs text-koopje-black/50">
                                {order.aangemaaktOp || "Aanmaaktijd onbekend"}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-medium text-koopje-black">
                              {formatKlantOrderPrijs(order.totaalPrijs)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {openOrder && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setOpenOrderId(null)}
                        className="mb-4 inline-flex items-center gap-1.5 text-sm text-koopje-black/60 transition hover:text-koopje-black"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Terug naar overzicht
                      </button>

                      <div className="mb-5">
                        <h3 className="text-base font-semibold text-koopje-black">
                          {openOrder.typeLabel}
                        </h3>
                        {openOrder.orderNummer && (
                          <p className="mt-0.5 text-sm text-koopje-black/55">
                            {openOrder.orderNummer}
                          </p>
                        )}
                      </div>

                      <dl className="grid gap-5 sm:grid-cols-2">
                        <Field
                          label="Aangemaakt"
                          value={openOrder.aangemaaktOp || ""}
                        />
                        <Field
                          label="Afgerond"
                          value={openOrder.afgerondOp || ""}
                        />
                        <Field
                          label="Bezorger"
                          value={openOrder.bezorger || ""}
                        />
                        <Field
                          label="Totaalprijs"
                          value={formatKlantOrderPrijs(openOrder.totaalPrijs)}
                        />
                        <div className="sm:col-span-2">
                          <Field
                            label="Opmerking"
                            value={openOrder.opmerking || ""}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                            Producten
                          </dt>
                          <dd className="mt-2">
                            {openOrder.producten.length === 0 ? (
                              <p className="text-sm text-koopje-black/45">—</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {openOrder.producten.map((p, idx) => (
                                  <li
                                    key={`${p.naam}-${idx}`}
                                    className="flex items-start justify-between gap-3 text-sm text-koopje-black"
                                  >
                                    <span>{p.naam}</span>
                                    {p.prijs != null && (
                                      <span className="shrink-0 text-koopje-black/60">
                                        {formatKlantOrderPrijs(p.prijs)}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                            Factuur / aankoopbewijs
                          </dt>
                          <dd className="mt-2 flex flex-wrap gap-3 text-sm">
                            {openOrder.linkFactuur && (
                              <a
                                href={openOrder.linkFactuur}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-koopje-orange underline-offset-2 hover:underline"
                              >
                                Factuur openen
                              </a>
                            )}
                            {openOrder.linkAankoopbewijs && (
                              <a
                                href={openOrder.linkAankoopbewijs}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-koopje-orange underline-offset-2 hover:underline"
                              >
                                Aankoopbewijs openen
                              </a>
                            )}
                            {!openOrder.linkFactuur &&
                              !openOrder.linkAankoopbewijs && (
                                <span className="text-koopje-black/45">—</span>
                              )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
