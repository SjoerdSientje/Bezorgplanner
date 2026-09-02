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

type Filter = "alle" | "fiets" | "onderdeel" | "overig";
const FILTER_LABELS: Record<Filter, string> = {
  alle: "Alle producten",
  fiets: "Fietsen",
  onderdeel: "Onderdelen",
  overig: "Overige",
};

type StockFilter = "alle" | "laag" | "uitverkocht";

type MutationType = "inkomend" | "uitgaand" | "correctie";

type ProductMutationDraft = {
  quantity: string;
  note: string;
};

function defaultMutationDraft(): ProductMutationDraft {
  return { quantity: "1", note: "" };
}

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
    case "moneybird":
      return "Moneybird";
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
  const hay = `${product.title} ${product.model_name ?? ""} ${product.color_name ?? ""} ${product.category} ${product.levertijd ?? ""} ${product.opmerking ?? ""}`.toLowerCase();
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
  const [manageStep, setManageStep] = useState<"pick" | "mutate">("pick");
  const [manageSelectedIds, setManageSelectedIds] = useState<Set<string>>(new Set());
  const [manageSearch, setManageSearch] = useState("");
  const [manageMutationsById, setManageMutationsById] = useState<
    Record<string, ProductMutationDraft>
  >({});

  const [mutationType, setMutationType] = useState<MutationType>("inkomend");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [editLevertijd, setEditLevertijd] = useState("");
  const [editOpmerking, setEditOpmerking] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingOpmerkingId, setSavingOpmerkingId] = useState<string | null>(null);

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

  const managePickProducts = useMemo(() => {
    return products.filter((p) => matchesInventorySearch(p, manageSearch));
  }, [products, manageSearch]);

  const manageSelectedProducts = useMemo(() => {
    return products.filter((p) => manageSelectedIds.has(p.id));
  }, [products, manageSelectedIds]);

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
    setEditLevertijd(product.levertijd ?? "");
    setEditOpmerking(product.opmerking ?? "");
    resetMutationForm();
    setError(null);
  };

  const openManageModal = () => {
    setManageOpen(true);
    setManageStep("pick");
    setManageSelectedIds(new Set());
    setManageSearch("");
    setManageMutationsById({});
    resetMutationForm();
    setError(null);
  };

  const closeModals = () => {
    setEditProduct(null);
    setManageOpen(false);
    setManageStep("pick");
    setManageSelectedIds(new Set());
    setManageSearch("");
    setManageMutationsById({});
  };

  const toggleManageProduct = (productId: string) => {
    setManageSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleAllManagePick = () => {
    const visibleIds = managePickProducts.map((p) => p.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => manageSelectedIds.has(id));
    setManageSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const goToManageMutate = () => {
    if (manageSelectedIds.size === 0) {
      setError("Selecteer minstens één product.");
      return;
    }
    const drafts: Record<string, ProductMutationDraft> = {};
    for (const id of Array.from(manageSelectedIds)) {
      drafts[id] = manageMutationsById[id] ?? defaultMutationDraft();
    }
    setManageMutationsById(drafts);
    setMutationType("inkomend");
    setManageStep("mutate");
    setError(null);
  };

  const updateManageMutation = (
    productId: string,
    patch: Partial<ProductMutationDraft>
  ) => {
    setManageMutationsById((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] ?? defaultMutationDraft()), ...patch },
    }));
  };

  const saveOpmerkingInline = async (productId: string, opmerking: string) => {
    const current = products.find((p) => p.id === productId);
    const next = opmerking.trim() || null;
    const prev = current?.opmerking?.trim() || null;
    if (next === prev) return;

    setSavingOpmerkingId(productId);
    setError(null);
    // Optimistisch
    setProducts((list) =>
      list.map((p) => (p.id === productId ? { ...p, opmerking: next } : p))
    );
    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, opmerking: opmerking }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Opmerking opslaan mislukt");
      const updated = data.product as InventoryProductRow;
      setProducts((list) =>
        list.map((p) => (p.id === updated.id ? { ...p, opmerking: updated.opmerking } : p))
      );
    } catch (e) {
      // Rollback
      if (current) {
        setProducts((list) =>
          list.map((p) => (p.id === productId ? { ...p, opmerking: current.opmerking } : p))
        );
      }
      setError(e instanceof Error ? e.message : "Opmerking opslaan mislukt");
    } finally {
      setSavingOpmerkingId(null);
    }
  };

  const opmerkingInput = (product: InventoryProductRow, className: string) => (
    <input
      type="text"
      key={`${product.id}-${product.opmerking ?? ""}`}
      defaultValue={product.opmerking ?? ""}
      placeholder="Typ een opmerking…"
      disabled={savingOpmerkingId === product.id}
      onBlur={(e) => {
        void saveOpmerkingInline(product.id, e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className={className}
      aria-label={`Opmerking voor ${product.title}`}
    />
  );

  const saveProductMeta = async (product: InventoryProductRow) => {
    setSavingMeta(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          levertijd: editLevertijd,
          opmerking: editOpmerking,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Opslaan mislukt");
      const updated = data.product as InventoryProductRow;
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
      if (editProduct?.id === updated.id) setEditProduct({ ...editProduct, ...updated });
      setMessage("Levertijd en opmerking opgeslagen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingMeta(false);
    }
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
      // Bewaar levertijd/opmerking mee als die gewijzigd zijn.
      await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          levertijd: editLevertijd,
          opmerking: editOpmerking,
        }),
      });

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

  const submitBulkMutation = async () => {
    if (manageSelectedProducts.length === 0) {
      setError("Geen producten geselecteerd.");
      return;
    }

    for (const product of manageSelectedProducts) {
      const draft = manageMutationsById[product.id] ?? defaultMutationDraft();
      const qty = parseInt(draft.quantity, 10);
      if (!Number.isFinite(qty) || qty < 0) {
        setError(`Ongeldig aantal voor ${product.title}.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    let ok = 0;
    const failed: string[] = [];

    try {
      for (const product of manageSelectedProducts) {
        const draft = manageMutationsById[product.id] ?? defaultMutationDraft();
        const qty = parseInt(draft.quantity, 10);
        const res = await fetch("/api/inventory/mutate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: product.id,
            mutationType,
            quantity: qty,
            note: draft.note.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failed.push(`${product.title}: ${data?.error ?? "mislukt"}`);
        } else {
          ok += 1;
        }
      }

      if (ok > 0) {
        closeModals();
        setMessage(
          failed.length > 0
            ? `${ok} product(en) bijgewerkt. ${failed.length} mislukt: ${failed.slice(0, 2).join(" | ")}`
            : `${ok} product(en) bijgewerkt.`
        );
        await load(false);
      } else {
        setError(failed[0] ?? "Mutatie mislukt voor alle geselecteerde producten.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mutatie mislukt");
    } finally {
      setSaving(false);
    }
  };

  const bulkMutationForm = () => (
    <>
      <p className="mt-1 text-sm text-stone-600">
        Kies het mutatietype voor de hele lijst; stel per product het aantal in (
        {manageSelectedProducts.length} geselecteerd).
      </p>

      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-400">
        Mutatietype (voor alle producten)
      </p>
      <div className="mt-2 flex gap-2">
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

      <ul className="mt-4 max-h-[min(24rem,55vh)] space-y-3 overflow-y-auto pr-1">
        {manageSelectedProducts.map((p) => {
          const draft = manageMutationsById[p.id] ?? defaultMutationDraft();
          return (
            <li
              key={p.id}
              className="rounded-xl border border-stone-200 bg-stone-50/60 p-3"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-koopje-black">
                  {p.title}
                </p>
                <span className={`shrink-0 text-xs ${stockClass(p.stock_quantity)}`}>
                  nu: {p.stock_quantity}
                </span>
              </div>

              <div className="grid grid-cols-[5rem_1fr] gap-2">
                <div>
                  <label className="block text-[10px] font-medium uppercase text-stone-400">
                    {mutationType === "correctie" ? "Nieuw" : "Aantal"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.quantity}
                    onChange={(e) => updateManageMutation(p.id, { quantity: e.target.value })}
                    className="mt-0.5 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium uppercase text-stone-400">
                    Opmerking
                  </label>
                  <input
                    type="text"
                    value={draft.note}
                    onChange={(e) => updateManageMutation(p.id, { note: e.target.value })}
                    placeholder="Optioneel"
                    className="mt-0.5 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setManageStep("pick");
            setError(null);
          }}
          className="rounded-xl px-4 py-2 text-sm text-stone-600"
        >
          Terug
        </button>
        <button type="button" onClick={closeModals} className="rounded-xl px-4 py-2 text-sm text-stone-600">
          Annuleren
        </button>
        <button
          type="button"
          onClick={() => void submitBulkMutation()}
          disabled={saving}
          className="rounded-xl bg-koopje-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Opslaan…" : `${manageSelectedProducts.length} producten opslaan`}
        </button>
      </div>
    </>
  );

  const managePickForm = () => {
    const allSelectedVisible =
      managePickProducts.length > 0 &&
      managePickProducts.every((p) => manageSelectedIds.has(p.id));

    return (
      <>
        <p className="mt-1 text-sm text-stone-600">
          Selecteer producten; daarna stel je per product de mutatie in (bijv. 5× V20, 6× V8).
        </p>

        <label className="mt-4 block text-xs font-medium text-stone-500">Zoeken</label>
        <input
          type="search"
          value={manageSearch}
          onChange={(e) => setManageSearch(e.target.value)}
          placeholder="Filter producten…"
          autoFocus
          className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
        />

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-600">
            <input
              type="checkbox"
              checked={allSelectedVisible}
              onChange={toggleAllManagePick}
              className="h-4 w-4 rounded accent-koopje-orange"
            />
            Alles selecteren ({managePickProducts.length})
          </label>
          <span className="text-xs text-stone-500">{manageSelectedIds.size} gekozen</span>
        </div>

        <ul className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-stone-200">
          {managePickProducts.map((p) => {
            const selected = manageSelectedIds.has(p.id);
            return (
              <li key={p.id} className="border-b border-stone-100 last:border-b-0">
                <label
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-stone-50 ${
                    selected ? "bg-koopje-orange-light/40" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleManageProduct(p.id)}
                    className="h-4 w-4 shrink-0 rounded accent-koopje-orange"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-koopje-black">
                    {p.title}
                  </span>
                  <span className={`shrink-0 text-xs ${stockClass(p.stock_quantity)}`}>
                    {p.stock_quantity}
                  </span>
                </label>
              </li>
            );
          })}
          {managePickProducts.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-stone-400">Geen producten gevonden.</li>
          )}
        </ul>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={closeModals} className="rounded-xl px-4 py-2 text-sm text-stone-600">
            Annuleren
          </button>
          <button
            type="button"
            onClick={goToManageMutate}
            disabled={manageSelectedIds.size === 0}
            className="rounded-xl bg-koopje-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Doorgaan ({manageSelectedIds.size})
          </button>
        </div>
      </>
    );
  };

  const metaFields = (product: InventoryProductRow) => (
    <div className="mt-3 space-y-3 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Productinfo</p>
      <div>
        <label className="block text-xs font-medium text-stone-500">
          Levertijd{" "}
          <span className="font-normal normal-case text-stone-400">
            (uit Shopify metafields; bij product-update)
          </span>
        </label>
        <input
          type="text"
          value={editLevertijd}
          onChange={(e) => setEditLevertijd(e.target.value)}
          placeholder="Sync vanuit custom.levertijd / restock_datum"
          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-stone-500">Opmerking</label>
        <textarea
          value={editOpmerking}
          onChange={(e) => setEditOpmerking(e.target.value)}
          rows={2}
          placeholder="Optionele notitie…"
          className="mt-1 w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
        />
      </div>
      <button
        type="button"
        onClick={() => saveProductMeta(product)}
        disabled={savingMeta}
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-koopje-black hover:bg-stone-50 disabled:opacity-50"
      >
        {savingMeta ? "Opslaan…" : "Alleen info opslaan"}
      </button>
    </div>
  );

  const mutationForm = (product: InventoryProductRow, onSubmit: () => void) => (
    <>
      <p className="mt-1 text-sm text-stone-600">{product.title}</p>
      <p className="mt-1 text-sm">
        Huidige voorraad:{" "}
        <span className={stockClass(product.stock_quantity)}>{product.stock_quantity}</span>
      </p>

      {metaFields(product)}

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-stone-400">Voorraadmutatie</p>

      <div className="mt-2 flex gap-2">
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

      <label className="mt-3 block text-xs font-medium text-stone-500">Mutatie-opmerking (optioneel)</label>
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
          {saving ? "Opslaan…" : "Voorraad opslaan"}
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
            <>
              {/* Mobiel: kaarten */}
              <div className="space-y-3 md:hidden">
                {displayedProducts.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug text-koopje-black">{p.title}</p>
                        <p className="mt-0.5 text-xs capitalize text-stone-500">{p.category}</p>
                      </div>
                      <span className={`shrink-0 text-base ${stockClass(p.stock_quantity)}`}>
                        {p.stock_quantity}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                      <div className="flex gap-2">
                        <span className="w-20 shrink-0 text-xs font-medium uppercase text-stone-400">
                          Levertijd
                        </span>
                        <span className="min-w-0 text-stone-700">{p.levertijd?.trim() || "—"}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium uppercase text-stone-400">
                          Opmerking
                          {savingOpmerkingId === p.id ? (
                            <span className="ml-1 normal-case text-stone-400">opslaan…</span>
                          ) : null}
                        </span>
                        {opmerkingInput(
                          p,
                          "w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-700 placeholder:text-stone-300 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 pt-3">
                      <span className="text-xs text-stone-400">
                        {sourceLabel(p.last_mutation_source)}
                      </span>
                      <button
                        type="button"
                        onClick={() => openEditModal(p)}
                        className="rounded-lg border border-koopje-orange px-3 py-1.5 text-xs font-medium text-koopje-orange hover:bg-koopje-orange-light"
                      >
                        Aanpassen
                      </button>
                    </div>
                  </div>
                ))}
                {displayedProducts.length === 0 && (
                  <p className="rounded-xl border border-stone-200 px-4 py-8 text-center text-stone-500">
                    {inventorySearch.trim()
                      ? "Geen producten gevonden voor deze zoekopdracht."
                      : "Geen producten gevonden. Klik op \"Opnieuw syncen\"."}
                  </p>
                )}
              </div>

              {/* Desktop: tabel */}
              <div className="hidden overflow-x-auto rounded-xl border border-stone-200 md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                    <tr>
                      <th className="px-4 py-3">Product</th>
                      <th className="whitespace-nowrap px-3 py-3">Cat.</th>
                      <th className="whitespace-nowrap px-3 py-3">Voorraad</th>
                      <th className="px-3 py-3">Levertijd</th>
                      <th className="min-w-[10rem] px-3 py-3">Opmerking</th>
                      <th className="hidden px-3 py-3 lg:table-cell">Bron</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedProducts.map((p) => (
                      <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50/50">
                        <td className="max-w-[14rem] px-4 py-3 font-medium text-koopje-black xl:max-w-xs">
                          <span className="line-clamp-2">{p.title}</span>
                        </td>
                        <td className="px-3 py-3 capitalize text-stone-600">{p.category}</td>
                        <td className={`px-3 py-3 ${stockClass(p.stock_quantity)}`}>
                          {p.stock_quantity}
                        </td>
                        <td className="max-w-[8rem] px-3 py-3 text-stone-700">
                          <span className="line-clamp-2">{p.levertijd?.trim() || "—"}</span>
                        </td>
                        <td className="min-w-[12rem] max-w-[16rem] px-3 py-2 xl:max-w-[20rem]">
                          {opmerkingInput(
                            p,
                            `w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-stone-700 placeholder:text-stone-300 hover:border-stone-200 focus:border-koopje-orange focus:bg-white focus:outline-none focus:ring-1 focus:ring-koopje-orange ${
                              savingOpmerkingId === p.id ? "opacity-60" : ""
                            }`
                          )}
                        </td>
                        <td className="hidden px-3 py-3 text-stone-500 lg:table-cell">
                          {sourceLabel(p.last_mutation_source)}
                        </td>
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
                        <td colSpan={7} className="px-4 py-8 text-center text-stone-500">
                          {inventorySearch.trim()
                            ? "Geen producten gevonden voor deze zoekopdracht."
                            : "Geen producten gevonden. Klik op \"Opnieuw syncen\"."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
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
            <div
              className={`w-full rounded-2xl bg-white p-6 shadow-xl ${
                manageStep === "mutate" ? "max-w-xl" : "max-w-lg"
              }`}
            >
              <h2 className="text-lg font-semibold text-koopje-black">Voorraad beheren</h2>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              {manageStep === "pick" ? managePickForm() : bulkMutationForm()}
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
