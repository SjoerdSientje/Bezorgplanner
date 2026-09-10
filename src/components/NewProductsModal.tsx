"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  InventoryPendingProductRow,
  PendingAiSuggestion,
} from "@/lib/inventory-pending";

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

type LocalSearchHit = {
  inventory_product_id: string;
  title: string;
  stock_quantity: number | null;
  image_url: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  fiets: "Fiets",
  onderdeel: "Onderdeel",
  accessoire: "Accessoire",
  overig: "Overig",
};

function suggestionLabel(s: PendingAiSuggestion | null): string {
  if (!s) return "Geen AI-suggestie";
  if (s.type === "link_existing") {
    return `Koppelen aan: ${s.inventoryProductTitle ?? s.inventoryProductId ?? "?"}`;
  }
  return `Nieuwe regel: ${s.suggestedTitle ?? "—"}`;
}

export default function NewProductsModal({ open, onClose, onChanged }: Props) {
  const [products, setProducts] = useState<InventoryPendingProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [stockById, setStockById] = useState<Record<string, string>>({});
  const [ignoreId, setIgnoreId] = useState<string | null>(null);
  const [ignoreMode, setIgnoreMode] = useState<"new_rule" | "link_existing">("new_rule");
  const [ignoreTitle, setIgnoreTitle] = useState("");
  const [ignoreStock, setIgnoreStock] = useState("0");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkHits, setLinkHits] = useState<LocalSearchHit[]>([]);
  const [linkSelected, setLinkSelected] = useState<LocalSearchHit | null>(null);
  const [linkSearching, setLinkSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/pending-products?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden mislukt");
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
    setIgnoreId(null);
    setLinkSelected(null);
    setLinkHits([]);
    setLinkQuery("");
    load();
  }, [open, load]);

  useEffect(() => {
    if (!ignoreId || ignoreMode !== "link_existing") return;
    const q = linkQuery.trim();
    if (q.length < 2) {
      setLinkHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLinkSearching(true);
      try {
        const res = await fetch(
          `/api/inventory/search?q=${encodeURIComponent(q)}&t=${Date.now()}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (cancelled) return;
        const results = Array.isArray(data.results) ? data.results : [];
        setLinkHits(
          results
            .filter((r: LocalSearchHit) => r.inventory_product_id)
            .slice(0, 12)
            .map((r: LocalSearchHit) => ({
              inventory_product_id: r.inventory_product_id,
              title: r.title,
              stock_quantity: r.stock_quantity,
              image_url: r.image_url,
            }))
        );
      } catch {
        if (!cancelled) setLinkHits([]);
      } finally {
        if (!cancelled) setLinkSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ignoreId, ignoreMode, linkQuery]);

  const openIgnore = (row: InventoryPendingProductRow) => {
    setIgnoreId(row.id);
    setIgnoreMode("new_rule");
    setIgnoreTitle(row.ai_suggestion?.suggestedTitle || row.title);
    setIgnoreStock("0");
    setLinkQuery("");
    setLinkHits([]);
    setLinkSelected(null);
    setMessage(null);
    setError(null);
  };

  const approve = async (row: InventoryPendingProductRow) => {
    const suggestion = row.ai_suggestion;
    const needsStock = !suggestion || suggestion.type === "new_rule";
    let stockQuantity: number | undefined;
    if (needsStock) {
      const raw = stockById[row.id] ?? "0";
      stockQuantity = Math.floor(Number(raw));
      if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
        setError("Vul een geldige voorraad in (0 of hoger).");
        return;
      }
    }

    setBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/inventory/pending-products/${row.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          needsStock ? { stockQuantity } : {}
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Goedkeuren mislukt");
      setMessage("Suggestie toegepast.");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Goedkeuren mislukt");
    } finally {
      setBusyId(null);
    }
  };

  const resolveIgnore = async () => {
    if (!ignoreId) return;
    setBusyId(ignoreId);
    setError(null);
    setMessage(null);
    try {
      const body =
        ignoreMode === "link_existing"
          ? {
              mode: "link_existing",
              inventoryProductId: linkSelected?.inventory_product_id,
            }
          : {
              mode: "new_rule",
              title: ignoreTitle,
              stockQuantity: Math.floor(Number(ignoreStock)),
            };

      if (ignoreMode === "link_existing" && !linkSelected?.inventory_product_id) {
        throw new Error("Kies een bestaande voorraadregel.");
      }
      if (ignoreMode === "new_rule") {
        const stock = Math.floor(Number(ignoreStock));
        if (!Number.isFinite(stock) || stock < 0) {
          throw new Error("Vul een geldige voorraad in (0 of hoger).");
        }
      }

      const res = await fetch(`/api/inventory/pending-products/${ignoreId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Opslaan mislukt");
      setIgnoreId(null);
      setMessage("Product verwerkt.");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-labelledby="new-products-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
          <div>
            <h2
              id="new-products-title"
              className="text-base font-semibold text-koopje-black sm:text-lg"
            >
              Nieuwe producten
            </h2>
            <p className="text-xs text-stone-500 sm:text-sm">
              Actieve Shopify-producten die nog geen voorraadregel hebben. Goedkeuren
              volgt de AI-suggestie; Negeren laat je zelf kiezen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          {message && <p className="mb-3 text-sm text-green-700">{message}</p>}
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          {loading ? (
            <p className="text-sm text-stone-500">Laden…</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-stone-500">Geen nieuwe producten in de wachtrij.</p>
          ) : (
            <ul className="space-y-3">
              {products.map((row) => {
                const suggestion = row.ai_suggestion;
                const needsStock = !suggestion || suggestion.type === "new_rule";
                const isIgnoring = ignoreId === row.id;
                return (
                  <li
                    key={row.id}
                    className="rounded-xl border border-stone-200 bg-stone-50/60 p-3"
                  >
                    <div className="flex gap-3">
                      {row.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.image_url}
                          alt=""
                          className="h-16 w-16 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-xs text-stone-500">
                          —
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-koopje-black">{row.title}</p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          {CATEGORY_LABEL[row.category] ?? row.category}
                          {row.collection_handles?.length
                            ? ` · ${row.collection_handles.join(", ")}`
                            : ""}
                        </p>
                        <p className="mt-1 text-xs text-stone-600">
                          {suggestionLabel(suggestion)}
                          {suggestion?.rationale ? (
                            <span className="text-stone-400"> — {suggestion.rationale}</span>
                          ) : null}
                        </p>

                        {needsStock && !isIgnoring && (
                          <label className="mt-2 flex items-center gap-2 text-xs text-stone-600">
                            Voorraad bij nieuwe regel
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={stockById[row.id] ?? "0"}
                              onChange={(e) =>
                                setStockById((prev) => ({
                                  ...prev,
                                  [row.id]: e.target.value,
                                }))
                              }
                              className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
                            />
                          </label>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => approve(row)}
                            className="rounded-lg bg-koopje-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
                          >
                            {busyId === row.id ? "Bezig…" : "Goedkeuren"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() =>
                              isIgnoring ? setIgnoreId(null) : openIgnore(row)
                            }
                            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                          >
                            {isIgnoring ? "Annuleren" : "Negeren"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isIgnoring && (
                      <div className="mt-3 rounded-lg border border-stone-200 bg-white p-3">
                        <p className="text-xs font-medium text-stone-600">Zelf kiezen</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setIgnoreMode("new_rule")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                              ignoreMode === "new_rule"
                                ? "bg-koopje-black text-white"
                                : "border border-stone-300 text-stone-700"
                            }`}
                          >
                            Nieuwe voorraadregel
                          </button>
                          <button
                            type="button"
                            onClick={() => setIgnoreMode("link_existing")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                              ignoreMode === "link_existing"
                                ? "bg-koopje-black text-white"
                                : "border border-stone-300 text-stone-700"
                            }`}
                          >
                            Koppelen aan bestaande
                          </button>
                        </div>

                        {ignoreMode === "new_rule" ? (
                          <div className="mt-3 space-y-2">
                            <label className="block text-xs text-stone-600">
                              Titel voorraadregel
                              <input
                                type="text"
                                value={ignoreTitle}
                                onChange={(e) => setIgnoreTitle(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-stone-600">
                              Voorraad
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={ignoreStock}
                                onChange={(e) => setIgnoreStock(e.target.value)}
                                className="mt-1 w-24 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <label className="block text-xs text-stone-600">
                              Zoek bestaande regel
                              <input
                                type="search"
                                value={linkQuery}
                                onChange={(e) => {
                                  setLinkQuery(e.target.value);
                                  setLinkSelected(null);
                                }}
                                placeholder="Min. 2 tekens…"
                                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                              />
                            </label>
                            {linkSearching && (
                              <p className="text-xs text-stone-400">Zoeken…</p>
                            )}
                            {linkHits.length > 0 && (
                              <ul className="max-h-40 overflow-y-auto rounded-lg border border-stone-200">
                                {linkHits.map((hit) => (
                                  <li key={hit.inventory_product_id}>
                                    <button
                                      type="button"
                                      onClick={() => setLinkSelected(hit)}
                                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-stone-50 ${
                                        linkSelected?.inventory_product_id ===
                                        hit.inventory_product_id
                                          ? "bg-orange-50"
                                          : ""
                                      }`}
                                    >
                                      <span className="truncate">{hit.title}</span>
                                      <span className="ml-2 shrink-0 text-xs text-stone-400">
                                        {hit.stock_quantity ?? "—"}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {linkSelected && (
                              <p className="text-xs text-emerald-700">
                                Geselecteerd: {linkSelected.title}
                              </p>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={resolveIgnore}
                          className="mt-3 rounded-lg bg-koopje-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
                        >
                          {busyId === row.id ? "Bezig…" : "Toepassen"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
