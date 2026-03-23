"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface LineItem {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
  defaultItems?: string[];
}

interface EditRow {
  _id: string;
  name: string;
  price: string; // string zodat gebruiker vrij kan typen
  isFiets: boolean;
  properties: { name: string; value: string }[];
  defaultItems?: string[];
}

interface Props {
  value: string;
  lineItemsJson?: string | null;
  /** Simpele tekst-save (legacy, wordt niet meer gebruikt in ritjes-vandaag) */
  onSave?: (value: string) => void;
  /** Multi-field save: producten + line_items_json + bestelling_totaal_prijs */
  onSaveMulti?: (fields: Record<string, unknown>) => Promise<void>;
}

let idCounter = 0;
function genId() { return String(++idCounter); }

function parseToEditRows(lineItemsJson: string | null | undefined, fallbackText: string): EditRow[] {
  if (lineItemsJson) {
    try {
      const items = JSON.parse(lineItemsJson) as LineItem[];
      return items.map((item) => ({
        _id: genId(),
        name: item.name ?? "",
        price: item.price != null ? String(item.price) : "0",
        isFiets: item.isFiets ?? false,
        properties: item.properties ?? [],
        defaultItems: item.defaultItems ?? [],
      }));
    } catch { /* fall through */ }
  }
  if (fallbackText) {
    return fallbackText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ _id: genId(), name, price: "0", isFiets: false, properties: [], defaultItems: [] }));
  }
  return [];
}

function buildLineItemsJsonFromRows(rows: EditRow[]): string {
  const items: LineItem[] = rows.map(({ _id: _, price, ...rest }) => ({
    ...rest,
    price: parseFloat(price) || 0,
  }));
  return JSON.stringify(items);
}

export default function ProductenCell({ value, lineItemsJson, onSave, onSaveMulti }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("0");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Sluit paneel als buiten geklikt
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (editing) return; // niet sluiten terwijl aan het bewerken
        setPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  // Lees producten uit JSON/tekst bij openen
  function openPanel() {
    setRows(parseToEditRows(lineItemsJson, value));
    setEditing(false);
    setPanelOpen(true);
  }

  function startEditing() {
    setRows(parseToEditRows(lineItemsJson, value));
    setNewName("");
    setNewPrice("0");
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setRows(parseToEditRows(lineItemsJson, value));
  }

  function updateRow(id: string, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((r) => r._id === id ? { ...r, ...patch } : r));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r._id !== id));
  }

  function addProduct() {
    const name = newName.trim();
    if (!name) return;
    setRows((prev) => [
      ...prev,
      { _id: genId(), name, price: newPrice || "0", isFiets: false, properties: [], defaultItems: [] },
    ]);
    setNewName("");
    setNewPrice("0");
  }

  const totalPrice = rows.reduce((sum, r) => sum + (parseFloat(r.price) || 0), 0);

  const saveEdits = useCallback(async () => {
    setSaving(true);
    try {
      const newLineItemsJson = buildLineItemsJsonFromRows(rows);
      const newProductenText = rows.map((r) => r.name).filter(Boolean).join("\n");

      if (onSaveMulti) {
        await onSaveMulti({
          producten: newProductenText || null,
          line_items_json: newLineItemsJson,
          bestelling_totaal_prijs: totalPrice || null,
        });
      } else if (onSave) {
        onSave(newProductenText);
      }
      setEditing(false);
      setPanelOpen(false);
    } finally {
      setSaving(false);
    }
  }, [rows, totalPrice, onSaveMulti, onSave]);

  // Platte weergavetekst
  let displayItems: LineItem[] = [];
  if (lineItemsJson) {
    try { displayItems = JSON.parse(lineItemsJson) as LineItem[]; } catch { /* ignore */ }
  }
  const hasStructured = displayItems.length > 0;
  const displayText = value || "—";

  return (
    <div ref={ref} className="relative">
      {/* Cel-inhoud */}
      <button
        type="button"
        onClick={openPanel}
        className="w-full px-2 py-1.5 text-left text-sm text-stone-700 hover:bg-koopje-orange-light/40"
      >
        <span className="line-clamp-2 leading-snug">{displayText}</span>
        <span className="ml-1 inline-block align-middle text-[10px] text-koopje-orange opacity-70">▾</span>
      </button>

      {/* Paneel */}
      {panelOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-96 rounded-xl border border-stone-200 bg-white shadow-2xl"
          style={{ minWidth: "22rem" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              {editing ? "Producten bewerken" : "Productoverzicht"}
            </p>
            <div className="flex gap-1">
              {!editing && (onSaveMulti || onSave) && (
                <button
                  type="button"
                  onClick={startEditing}
                  title="Bewerken"
                  className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-koopje-orange"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => { setPanelOpen(false); setEditing(false); }}
                className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-3">
            {editing ? (
              /* ── Edit mode ── */
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <div
                    key={row._id}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                      row.isFiets ? "border-koopje-orange/30 bg-orange-50" : "border-stone-200 bg-stone-50"
                    }`}
                  >
                    {row.isFiets && <span className="shrink-0 text-[10px]">🚲</span>}
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(row._id, { name: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-700 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                      placeholder="Productnaam"
                    />
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span className="text-xs text-stone-400">€</span>
                      <input
                        type="number"
                        value={row.price}
                        onChange={(e) => updateRow(row._id, { price: e.target.value })}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-700 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                        step="0.01"
                        min="0"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row._id)}
                      className="shrink-0 rounded p-0.5 text-stone-300 hover:bg-red-50 hover:text-red-500"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}

                {/* Nieuw product toevoegen */}
                <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-2 py-1.5">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProduct(); } }}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-500 placeholder:text-stone-300 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                    placeholder="Nieuw product…"
                  />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <span className="text-xs text-stone-400">€</span>
                    <input
                      type="number"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-500 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addProduct}
                    disabled={!newName.trim()}
                    className="shrink-0 rounded p-0.5 text-stone-300 hover:bg-green-50 hover:text-green-600 disabled:opacity-30"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>

                {/* Totaal */}
                <div className="flex items-center justify-between rounded-lg bg-stone-100 px-2 py-1.5 text-xs">
                  <span className="font-medium text-stone-500">Totaal prijs</span>
                  <span className="font-semibold text-stone-700">€ {totalPrice.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              /* ── View mode ── */
              <div className="space-y-2">
                {hasStructured ? (
                  displayItems.map((item, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-3 py-2 ${
                        item.isFiets ? "border-koopje-orange/30 bg-orange-50" : "border-stone-200 bg-stone-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-sm font-semibold leading-snug ${item.isFiets ? "text-koopje-orange" : "text-stone-700"}`}>
                          {item.isFiets && <span className="mr-1 text-[10px]">🚲</span>}
                          {item.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs text-stone-400">€{item.price.toFixed(2)}</span>
                      </div>
                      {item.properties.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 border-t border-stone-200 pt-1.5">
                          {item.properties.map((p, j) => (
                            <li key={j} className="flex gap-1.5 text-xs text-stone-600">
                              <span className="font-medium text-stone-500">{p.name}:</span>
                              <span>{p.value}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.defaultItems && item.defaultItems.length > 0 && (
                        <div className="mt-1.5 border-t border-dashed border-stone-200 pt-1.5">
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">Standaard inbegrepen</p>
                          <ul className="space-y-0.5">
                            {item.defaultItems.map((d, j) => (
                              <li key={j} className="flex items-center gap-1.5 text-xs text-stone-500">
                                <span className="text-[10px]">📦</span>{d}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    {value || "—"}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer knoppen (alleen edit mode) */}
          {editing && (
            <div className="flex gap-2 border-t border-stone-100 px-3 py-2">
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="flex-1 rounded-lg border border-stone-200 py-1.5 text-xs font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-50"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={saving}
                className="flex-1 rounded-lg bg-koopje-orange py-1.5 text-xs font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
              >
                {saving ? "Opslaan…" : "Opslaan"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
