"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  IncomingDeliveryItemRow,
  IncomingDeliveryRow,
} from "@/app/api/inventory/incoming-deliveries/route";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Na ontvangen: voorraadlijst herladen. */
  onStockChanged?: () => void;
};

type InventoryPick = {
  id: string;
  title: string;
  variant_title: string | null;
  model_name: string | null;
  color_name: string | null;
  stock_quantity: number;
  category: string;
};

type DraftProductLine = {
  key: string;
  productId: string;
  label: string;
  quantity: number;
};

type DraftFreeLine = {
  key: string;
  text: string;
  quantity: number;
};

function formatNl(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function trackHref(url: string): string {
  const s = url.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function productLabel(p: InventoryPick): string {
  const extra = [p.variant_title, p.model_name, p.color_name]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i);
  const base = p.title.trim() || "Voorraadregel";
  return extra.length ? `${base} (${extra.join(" · ")})` : base;
}

function itemLabel(item: IncomingDeliveryItemRow): string {
  if (item.is_free_text) return item.free_text?.trim() || item.product_title || "Vrije tekst";
  return item.product_title?.trim() || "Voorraadregel";
}

export default function IncomingDeliveriesModal({ open, onClose, onStockChanged }: Props) {
  const [pending, setPending] = useState<IncomingDeliveryRow[]>([]);
  const [received, setReceived] = useState<IncomingDeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [trackUrl, setTrackUrl] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [productLines, setProductLines] = useState<DraftProductLine[]>([]);
  const [freeLines, setFreeLines] = useState<DraftFreeLine[]>([]);
  const [freeDraft, setFreeDraft] = useState("");
  const [freeQty, setFreeQty] = useState(1);

  const [inventory, setInventory] = useState<InventoryPick[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/incoming-deliveries?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden mislukt");
      setPending(Array.isArray(data.pending) ? data.pending : []);
      setReceived(Array.isArray(data.received) ? data.received : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInventory = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventory?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      const list = Array.isArray(data.products) ? data.products : [];
      setInventory(
        list.map((p: Record<string, unknown>) => ({
          id: String(p.id),
          title: String(p.title ?? ""),
          variant_title: p.variant_title != null ? String(p.variant_title) : null,
          model_name: p.model_name != null ? String(p.model_name) : null,
          color_name: p.color_name != null ? String(p.color_name) : null,
          stock_quantity: Number(p.stock_quantity ?? 0),
          category: String(p.category ?? ""),
        }))
      );
    } catch {
      /* zoeken optioneel */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTrackUrl("");
    setExpectedDelivery("");
    setFile(null);
    setProductLines([]);
    setFreeLines([]);
    setFreeDraft("");
    setFreeQty(1);
    setSearch("");
    setMessage(null);
    setError(null);
    load();
    loadInventory();
  }, [open, load, loadInventory]);

  const selectedIds = useMemo(
    () => new Set(productLines.map((l) => l.productId)),
    [productLines]
  );

  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return inventory
      .filter((p) => !selectedIds.has(p.id))
      .filter((p) => {
        const hay = [p.title, p.variant_title, p.model_name, p.color_name, p.category]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [inventory, search, selectedIds]);

  const resetForm = () => {
    setTrackUrl("");
    setExpectedDelivery("");
    setFile(null);
    setProductLines([]);
    setFreeLines([]);
    setFreeDraft("");
    setFreeQty(1);
    setSearch("");
  };

  const addProduct = (p: InventoryPick) => {
    setProductLines((prev) => [
      ...prev,
      {
        key: `p-${p.id}-${Date.now()}`,
        productId: p.id,
        label: productLabel(p),
        quantity: 1,
      },
    ]);
    setSearch("");
  };

  const addFreeLine = () => {
    const text = freeDraft.trim();
    if (!text) return;
    const qty = Math.max(1, Math.floor(Number(freeQty) || 1));
    setFreeLines((prev) => [
      ...prev,
      { key: `f-${Date.now()}`, text, quantity: qty },
    ]);
    setFreeDraft("");
    setFreeQty(1);
  };

  const saveNew = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const items = [
        ...productLines.map((l) => ({
          product_id: l.productId,
          quantity: Math.max(1, Math.floor(l.quantity) || 1),
        })),
        ...freeLines.map((l) => ({
          free_text: l.text,
          quantity: Math.max(1, Math.floor(l.quantity) || 1),
        })),
      ];

      const form = new FormData();
      form.set("track_trace_url", trackUrl);
      form.set("expected_delivery", expectedDelivery);
      form.set("items", JSON.stringify(items));
      if (file) form.set("file", file);

      const res = await fetch("/api/inventory/incoming-deliveries", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Opslaan mislukt");
      resetForm();
      setMessage("Inkomende levering opgeslagen.");
      await load();
      onStockChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const patchAction = async (id: string, action: "receive" | "cancel") => {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/inventory/incoming-deliveries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Actie mislukt");
      setMessage(
        action === "receive"
          ? "Levering ontvangen — voorraad bijgewerkt."
          : "Levering geannuleerd."
      );
      await load();
      onStockChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie mislukt");
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-labelledby="incoming-deliveries-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
          <div>
            <h2
              id="incoming-deliveries-title"
              className="text-base font-semibold text-koopje-black sm:text-lg"
            >
              Inkomende leveringen
            </h2>
            <p className="text-xs text-stone-500 sm:text-sm">
              Track &amp; trace, verwachte levertijd en voorraadregels die onderweg zijn.
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
          <section className="rounded-xl border border-stone-200 bg-stone-50/80 p-4">
            <h3 className="text-sm font-semibold text-koopje-black">Nieuwe inkomende levering</h3>

            <label className="mt-3 block text-xs font-medium text-stone-600">
              Track &amp; trace-link
            </label>
            <input
              type="url"
              value={trackUrl}
              onChange={(e) => setTrackUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange/40"
            />

            <label className="mt-3 block text-xs font-medium text-stone-600">
              Verwachte levertijd (optioneel)
            </label>
            <input
              type="text"
              value={expectedDelivery}
              onChange={(e) => setExpectedDelivery(e.target.value)}
              placeholder="Bijv. 18 maart of week 12"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange/40"
            />

            <label className="mt-3 block text-xs font-medium text-stone-600">
              Bestand (optioneel)
            </label>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-koopje-black hover:file:bg-orange-100"
            />
            {file && (
              <p className="mt-1 text-xs text-stone-500">
                {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}

            <label className="mt-4 block text-xs font-medium text-stone-600">
              Voorraadregels zoeken
            </label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type minstens 2 tekens…"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange/40"
            />
            {searchHits.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-stone-200 bg-white">
                {searchHits.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProduct(p)}
                      className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-orange-50"
                    >
                      <span className="text-koopje-black">{productLabel(p)}</span>
                      <span className="shrink-0 text-xs text-stone-400">
                        voorraad {p.stock_quantity}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {productLines.length > 0 && (
              <ul className="mt-3 space-y-2">
                {productLines.map((line) => (
                  <li
                    key={line.key}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 text-sm text-koopje-black">{line.label}</span>
                    <label className="flex items-center gap-1 text-xs text-stone-500">
                      Aantal
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => {
                          const q = Math.max(1, Math.floor(Number(e.target.value) || 1));
                          setProductLines((prev) =>
                            prev.map((l) => (l.key === line.key ? { ...l, quantity: q } : l))
                          );
                        }}
                        className="w-16 rounded border border-stone-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setProductLines((prev) => prev.filter((l) => l.key !== line.key))
                      }
                      className="text-xs text-red-600 hover:underline"
                    >
                      Verwijder
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-white/70 p-3">
              <p className="text-xs font-medium text-stone-600">
                Vrije tekst (geen voorraadregel, bijv. gereedschap)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={freeDraft}
                  onChange={(e) => setFreeDraft(e.target.value)}
                  placeholder="Omschrijving"
                  className="min-w-[12rem] flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  value={freeQty}
                  onChange={(e) => setFreeQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="w-20 rounded-lg border border-stone-300 px-2 py-2 text-sm"
                  aria-label="Aantal vrije tekst"
                />
                <button
                  type="button"
                  onClick={addFreeLine}
                  disabled={!freeDraft.trim()}
                  className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-medium text-koopje-black hover:bg-stone-100 disabled:opacity-50"
                >
                  Toevoegen
                </button>
              </div>
              {freeLines.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {freeLines.map((line) => (
                    <li
                      key={line.key}
                      className="flex items-center justify-between gap-2 text-sm text-stone-700"
                    >
                      <span>
                        {line.quantity}× {line.text}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setFreeLines((prev) => prev.filter((l) => l.key !== line.key))
                        }
                        className="text-xs text-red-600 hover:underline"
                      >
                        Verwijder
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={saveNew}
              disabled={saving || !trackUrl.trim()}
              className="mt-4 rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
            >
              {saving ? "Opslaan…" : "Opslaan"}
            </button>
          </section>

          {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <section className="mt-6">
            <h3 className="text-sm font-semibold text-koopje-black">
              Onderweg ({pending.length})
            </h3>
            {loading ? (
              <p className="mt-2 text-sm text-stone-500">Laden…</p>
            ) : pending.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Geen openstaande leveringen.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {pending.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-stone-200 bg-white p-3"
                  >
                    <a
                      href={trackHref(row.track_trace_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm font-medium text-koopje-orange hover:underline"
                    >
                      {row.track_trace_url}
                    </a>
                    {row.expected_delivery && (
                      <p className="mt-1 text-sm text-stone-600">
                        Verwachte levertijd: {row.expected_delivery}
                      </p>
                    )}
                    {row.attachment_url && (
                      <p className="mt-1 text-sm">
                        <a
                          href={row.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-koopje-orange hover:underline"
                        >
                          {row.attachment_name || "Bijlage"}
                        </a>
                      </p>
                    )}
                    {(row.items?.length ?? 0) > 0 && (
                      <ul className="mt-2 space-y-0.5 text-sm text-stone-700">
                        {row.items!.map((item) => (
                          <li key={item.id}>
                            {item.quantity}× {itemLabel(item)}
                            {item.is_free_text ? (
                              <span className="text-xs text-stone-400"> (vrij)</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-stone-400">
                      Toegevoegd {formatNl(row.created_at)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => patchAction(row.id, "receive")}
                        disabled={busyId === row.id}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        {busyId === row.id ? "Bezig…" : "Levering ontvangen"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm("Deze onderweg-levering annuleren?")
                          ) {
                            return;
                          }
                          void patchAction(row.id, "cancel");
                        }}
                        disabled={busyId === row.id}
                        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                      >
                        Annuleren
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {received.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-koopje-black">
                Ontvangen ({received.length})
              </h3>
              <ul className="mt-3 space-y-2">
                {received.slice(0, 30).map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-stone-100 bg-stone-50/80 p-3"
                  >
                    <a
                      href={trackHref(row.track_trace_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm text-stone-700 hover:underline"
                    >
                      {row.track_trace_url}
                    </a>
                    {row.expected_delivery && (
                      <p className="mt-1 text-sm text-stone-500">
                        Verwachte levertijd was: {row.expected_delivery}
                      </p>
                    )}
                    {(row.items?.length ?? 0) > 0 && (
                      <ul className="mt-1 space-y-0.5 text-sm text-stone-600">
                        {row.items!.map((item) => (
                          <li key={item.id}>
                            {item.quantity}× {itemLabel(item)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-stone-400">
                      Ontvangen {formatNl(row.received_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
