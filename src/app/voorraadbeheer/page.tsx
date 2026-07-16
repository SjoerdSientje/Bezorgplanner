"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import {
  LOW_STOCK_THRESHOLD,
  type InventoryMutationGroup,
  type InventoryProductRow,
  type InventorySource,
} from "@/lib/inventory";

type Stats = {
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
  mutationsToday: number;
};

type ShopifySearchResult = {
  inventory_product_id: string | null;
  title: string;
  stock_quantity: number | null;
};

type Filter = "alle" | "fiets" | "onderdeel" | "overig";
const FILTER_LABELS: Record<Filter, string> = {
  alle: "Alle producten",
  fiets: "Fietsen",
  onderdeel: "Onderdelen",
  overig: "Overige",
};

type StockFilter = "alle" | "laag" | "uitverkocht";

type MutationType = "inkomend" | "uitgaand" | "correctie";

function mutationTypeLabel(t: MutationType): string {
  switch (t) {
    case "inkomend":
      return "Inkomend";
    case "uitgaand":
      return "Uitgaand";
    case "correctie":
      return "Correctie";
    default:
      return t;
  }
}

function stockClass(qty: number): string {
  if (qty === 0) return "text-red-600 font-semibold";
  if (qty <= LOW_STOCK_THRESHOLD) return "text-orange-600 font-semibold";
  return "text-green-700 font-semibold";
}

function sourceLabel(source: InventorySource | null): string {
  switch (source) {
    case "shopify":
      return "Shopify";
    case "marktplaats":
      return "Marktplaats";
    case "winkel":
      return "Winkel";
    case "handmatig":
      return "Handmatig";
    default:
      return "—";
  }
}

function matchesInventorySearch(product: InventoryProductRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${product.title} ${product.model_name ?? ""} ${product.color_name ?? ""} ${product.category}`.toLowerCase();
  return hay.includes(q);
}

export default function VoorraadbeheerPage() {
  const [products, setProducts] = useState<InventoryProductRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<Filter>("alle");
  const [stockFilter, setStockFilter] = useState<StockFilter>("alle");
  const [inventorySearch, setInventorySearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [mutationsOpen, setMutationsOpen] = useState(false);
  const [mutationsLoading, setMutationsLoading] = useState(false);
  const [mutationsError, setMutationsError] = useState<string | null>(null);
  const [mutationGroups, setMutationGroups] = useState<InventoryMutationGroup[]>([]);
  const [mutationsDate, setMutationsDate] = useState<string | null>(null);

  const [editProduct, setEditProduct] = useState<InventoryProductRow | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageProduct, setManageProduct] = useState<InventoryProductRow | null>(null);
  const [shopifyQuery, setShopifyQuery] = useState("");
  const [shopifyResults, setShopifyResults] = useState<ShopifySearchResult[]>([]);
  const [shopifySearching, setShopifySearching] = useState(false);

  const [mutationType, setMutationType] = useState<MutationType>("inkomend");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (runSync = false) => {
    if (runSync) setSyncing(true);
    else setLoading(true);
    setError(null);
    try {
      if (runSync) {
        const syncRes = await fetch("/api/inventory", { method: "POST" });
        const syncData = await syncRes.json();
        if (!syncRes.ok) throw new Error(syncData?.error ?? "Synchroniseren mislukt");
        setMessage(
          `Shopify gesynchroniseerd: ${syncData.inserted} nieuw, ${syncData.updated} bijgewerkt` +
            (syncData.removed ? `, ${syncData.removed} concept/archief verwijderd` : "") +
            "."
        );
      }

      const res = await fetch("/api/inventory", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden mislukt");
      setProducts(data.products ?? []);
      setStats(data.stats ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (!manageOpen || shopifyQuery.trim().length < 2) {
      setShopifyResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setShopifySearching(true);
      try {
        const res = await fetch(`/api/inventory/search?q=${encodeURIComponent(shopifyQuery.trim())}`);
        const data = await res.json();
        setShopifyResults(data.results ?? []);
      } catch {
        setShopifyResults([]);
      } finally {
        setShopifySearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [shopifyQuery, manageOpen]);

  const displayedProducts = useMemo(() => {
    return products.filter((p) => {
      if (filter !== "alle" && p.category !== filter) return false;
      if (stockFilter === "laag" && !(p.stock_quantity > 0 && p.stock_quantity <= LOW_STOCK_THRESHOLD)) {
        return false;
      }
      if (stockFilter === "uitverkocht" && p.stock_quantity !== 0) return false;
      return matchesInventorySearch(p, inventorySearch);
    });
  }, [products, filter, stockFilter, inventorySearch]);

  const toggleStockFilter = (f: StockFilter) => {
    setStockFilter((prev) => (prev === f ? "alle" : f));
  };

  const openMutationsModal = async () => {
    setMutationsOpen(true);
    setMutationsLoading(true);
    setMutationsError(null);
    try {
      const res = await fetch("/api/inventory/mutations", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden mislukt");
      setMutationGroups(data.groups ?? []);
      setMutationsDate(data.date ?? null);
    } catch (e) {
      setMutationsError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setMutationsLoading(false);
    }
  };

  const resetMutationForm = () => {
    setMutationType("inkomend");
    setQuantity("1");
    setNote("");
  };

  const openEditModal = (product: InventoryProductRow) => {
    setEditProduct(product);
    resetMutationForm();
    setError(null);
  };

  const openManageModal = () => {
    setManageOpen(true);
    setManageProduct(null);
    setShopifyQuery("");
    setShopifyResults([]);
    resetMutationForm();
    setError(null);
  };

  const closeModals = () => {
    setEditProduct(null);
    setManageOpen(false);
    setManageProduct(null);
    setShopifyQuery("");
    setShopifyResults([]);
  };

  const pickManageProduct = (result: ShopifySearchResult) => {
    if (!result.inventory_product_id) return;
    const found = products.find((p) => p.id === result.inventory_product_id);
    if (found) {
      setManageProduct(found);
    } else {
      setManageProduct({
        id: result.inventory_product_id,
        title: result.title,
        stock_quantity: result.stock_quantity ?? 0,
      } as InventoryProductRow);
    }
    setShopifyQuery("");
    setShopifyResults([]);
    resetMutationForm();
  };

  const submitMutation = async (product: InventoryProductRow) => {
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      setError("Ongeldig aantal.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          mutationType,
          quantity: qty,
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Mutatie mislukt");
      closeModals();
      setMessage("Voorraad bijgewerkt.");
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mutatie mislukt");
    } finally {
      setSaving(false);
    }
  };

  const mutationForm = (product: InventoryProductRow, onSubmit: () => void) => (
    <>
      <p className="mt-1 text-sm text-stone-600">{product.title}</p>
      <p className="mt-1 text-sm">
        Huidige voorraad:{" "}
        <span className={stockClass(product.stock_quantity)}>{product.stock_quantity}</span>
      </p>

      <div className="mt-4 flex gap-2">
        {(["inkomend", "uitgaand", "correctie"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setMutationType(t)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium capitalize ${
              mutationType === t
                ? "bg-koopje-orange text-white"
                : "border border-stone-200 text-koopje-black"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-xs font-medium text-stone-500">
        {mutationType === "correctie" ? "Nieuwe voorraad" : "Aantal"}
      </label>
      <input
        type="number"
        min={0}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
      />

      <label className="mt-3 block text-xs font-medium text-stone-500">Opmerking (optioneel)</label>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
      />

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={closeModals} className="rounded-xl px-4 py-2 text-sm text-stone-600">
          Annuleren
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="rounded-xl bg-koopje-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Opslaan…" : "Opslaan"}
        </button>
      </div>
    </>
  );

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-koopje-black/60 hover:text-koopje-black" aria-label="Terug">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Voorraadbeheer</h1>
                <p className="text-sm text-koopje-black/60">
                  Lokale voorraad; sync Shopify-catalogus via knop rechtsboven
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => load(true)}
              disabled={syncing}
              className="rounded-xl border border-koopje-black/20 bg-white px-4 py-2 text-sm font-medium text-koopje-black hover:bg-koopje-black/5 disabled:opacity-50"
            >
              {syncing ? "Synchroniseren…" : "Opnieuw syncen"}
            </button>
          </div>

          {stats && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setStockFilter("alle")}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  stockFilter === "alle"
                    ? "border-koopje-orange bg-koopje-orange-light"
                    : "border-stone-200 bg-stone-50 hover:bg-stone-100"
                }`}
              >
                <p className="text-xs text-stone-500">Totaal producten</p>
                <p className="mt-1 text-2xl font-semibold text-koopje-black">{stats.totalProducts}</p>
              </button>
              <button
                type="button"
                onClick={() => toggleStockFilter("laag")}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  stockFilter === "laag"
                    ? "border-orange-400 bg-orange-50"
                    : "border-stone-200 bg-stone-50 hover:bg-stone-100"
                }`}
              >
                <p className="text-xs text-stone-500">Laag op voorraad</p>
                <p className="mt-1 text-2xl font-semibold text-koopje-black">{stats.lowStock}</p>
              </button>
              <button
                type="button"
                onClick={() => toggleStockFilter("uitverkocht")}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  stockFilter === "uitverkocht"
                    ? "border-red-400 bg-red-50"
                    : "border-stone-200 bg-stone-50 hover:bg-stone-100"
                }`}
              >
                <p className="text-xs text-stone-500">Uitverkocht</p>
                <p className="mt-1 text-2xl font-semibold text-koopje-black">{stats.outOfStock}</p>
              </button>
              <button
                type="button"
                onClick={openMutationsModal}
                className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-left transition hover:bg-stone-100"
              >
                <p className="text-xs text-stone-500">Mutaties vandaag</p>
                <p className="mt-1 text-2xl font-semibold text-koopje-black">{stats.mutationsToday}</p>
              </button>
            </div>
          )}
          {stockFilter !== "alle" && (
            <p className="mb-4 -mt-2 text-xs text-stone-500">
              Filter actief: {stockFilter === "laag" ? "laag op voorraad" : "uitverkocht"} —{" "}
              <button type="button" onClick={() => setStockFilter("alle")} className="text-koopje-orange hover:underline">
                wis filter
              </button>
            </p>
          )}

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="search"
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                placeholder="Zoek in voorraad…"
                className="w-full rounded-xl border border-stone-200 py-2.5 pl-10 pr-4 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={openManageModal}
              className="shrink-0 rounded-xl bg-koopje-orange px-5 py-2.5 text-sm font-medium text-white hover:bg-koopje-orange/90"
            >
              Voorraad beheren
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {(["alle", "fiets", "onderdeel", "overig"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  filter === f
                    ? "bg-koopje-orange text-white"
                    : "border border-stone-200 bg-white text-koopje-black hover:bg-stone-50"
                }`}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
            <span className="ml-auto self-center text-sm text-stone-500">
              {displayedProducts.length} van {products.length} producten
            </span>
          </div>

          {message && <p className="mb-3 text-sm text-green-700">{message}</p>}
          {error && !editProduct && !manageOpen && (
            <p className="mb-3 text-sm text-red-600">{error}</p>
          )}

          {loading ? (
            <p className="text-sm text-stone-500">Laden…</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Categorie</th>
                    <th className="px-4 py-3">Voorraad</th>
                    <th className="px-4 py-3">Laatste bron</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {displayedProducts.map((p) => (
                    <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50/50">
                      <td className="px-4 py-3 font-medium text-koopje-black">{p.title}</td>
                      <td className="px-4 py-3 capitalize text-stone-600">{p.category}</td>
                      <td className={`px-4 py-3 ${stockClass(p.stock_quantity)}`}>{p.stock_quantity}</td>
                      <td className="px-4 py-3 text-stone-600">{sourceLabel(p.last_mutation_source)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className="rounded-lg border border-koopje-orange px-3 py-1.5 text-xs font-medium text-koopje-orange hover:bg-koopje-orange-light"
                        >
                          Aanpassen
                        </button>
                      </td>
                    </tr>
                  ))}
                  {displayedProducts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-stone-500">
                        {inventorySearch.trim()
                          ? "Geen producten gevonden voor deze zoekopdracht."
                          : "Geen producten gevonden. Klik op \"Opnieuw syncen\"."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {editProduct && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeModals} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-koopje-black">Voorraad aanpassen</h2>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              {mutationForm(editProduct, () => submitMutation(editProduct))}
            </div>
          </div>
        </>
      )}

      {manageOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeModals} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-koopje-black">Voorraad beheren</h2>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

              {!manageProduct ? (
                <>
                  <p className="mt-1 text-sm text-stone-600">
                    Zoek een product in Shopify om de voorraad aan te passen.
                  </p>
                  <label className="mt-4 block text-xs font-medium text-stone-500">Product zoeken</label>
                  <input
                    type="text"
                    value={shopifyQuery}
                    onChange={(e) => setShopifyQuery(e.target.value)}
                    placeholder="Typ productnaam…"
                    autoFocus
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
                  />
                  {shopifySearching && <p className="mt-1 text-xs text-stone-400">Zoeken…</p>}
                  {shopifyResults.length > 0 && (
                    <ul className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-stone-200">
                      {shopifyResults.map((r) => (
                        <li key={r.inventory_product_id ?? r.title}>
                          <button
                            type="button"
                            disabled={!r.inventory_product_id}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-stone-50 disabled:opacity-50"
                            onClick={() => pickManageProduct(r)}
                          >
                            <span>{r.title}</span>
                            <span className="ml-2 shrink-0 text-stone-400">
                              {r.stock_quantity ?? "?"} op voorraad
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {shopifyQuery.trim().length >= 2 && !shopifySearching && shopifyResults.length === 0 && (
                    <p className="mt-2 text-xs text-stone-400">Geen producten gevonden.</p>
                  )}
                  <div className="mt-6 flex justify-end">
                    <button
                      type="button"
                      onClick={closeModals}
                      className="rounded-xl px-4 py-2 text-sm text-stone-600"
                    >
                      Annuleren
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setManageProduct(null);
                      resetMutationForm();
                    }}
                    className="mt-2 text-xs text-koopje-orange hover:underline"
                  >
                    ← Ander product kiezen
                  </button>
                  {mutationForm(manageProduct, () => submitMutation(manageProduct))}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {mutationsOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMutationsOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-koopje-black">
                  Mutaties vandaag{mutationsDate ? ` — ${mutationsDate}` : ""}
                </h2>
                <button
                  type="button"
                  onClick={() => setMutationsOpen(false)}
                  className="text-stone-400 hover:text-koopje-black"
                  aria-label="Sluiten"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {mutationsLoading && <p className="mt-4 text-sm text-stone-500">Laden…</p>}
              {mutationsError && <p className="mt-4 text-sm text-red-600">{mutationsError}</p>}

              {!mutationsLoading && !mutationsError && mutationGroups.length === 0 && (
                <p className="mt-4 text-sm text-stone-500">Geen mutaties vandaag.</p>
              )}

              {!mutationsLoading && !mutationsError && mutationGroups.length > 0 && (
                <div className="mt-4 space-y-4">
                  {mutationGroups.map((group, idx) => (
                    <div
                      key={`${group.orderReference ?? "geen-order"}-${idx}`}
                      className="rounded-xl border border-stone-200 p-4"
                    >
                      <p className="text-sm font-semibold text-koopje-black">
                        Order: {group.orderReference ?? "Handmatig / geen order"}
                      </p>

                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium uppercase text-stone-400">Producten in order</p>
                          {group.orderProducten ? (
                            <ul className="mt-1 space-y-0.5 text-sm text-stone-600">
                              {group.orderProducten.split("\n").map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1 text-sm text-stone-400">Onbekend (geen order-snapshot)</p>
                          )}
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase text-stone-400">Werkelijke mutaties</p>
                          <ul className="mt-1 space-y-1.5 text-sm">
                            {group.mutations.map((m) => (
                              <li key={m.id} className="text-stone-700">
                                <span className="font-medium">{mutationTypeLabel(m.mutationType)}</span>{" "}
                                {m.quantity}x {m.productTitle}{" "}
                                <span className="text-stone-400">
                                  ({m.stockBefore} → {m.stockAfter}, {sourceLabel(m.source)})
                                </span>
                                {m.note && <span className="block text-xs text-stone-400">{m.note}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setMutationsOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm text-stone-600"
                >
                  Sluiten
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
