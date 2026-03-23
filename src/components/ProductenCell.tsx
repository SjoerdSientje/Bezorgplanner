"use client";

import { useState, useEffect, useRef } from "react";

interface LineItem {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
  defaultItems?: string[];
}

interface Props {
  /** Platte tekst-waarde voor het geval line_items_json ontbreekt */
  value: string;
  /** JSON-string zoals gegenereerd door buildLineItemsJson() */
  lineItemsJson?: string | null;
  /** Callback om nieuwe waarde op te slaan */
  onSave?: (value: string) => void;
}

export default function ProductenCell({ value, lineItemsJson, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        if (editing) commitEdit();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing, editValue]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  // Sync editValue als value van buiten verandert
  useEffect(() => {
    if (!editing) setEditValue(value);
  }, [value, editing]);

  function startEdit() {
    setEditValue(value);
    setOpen(false);
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    if (editValue !== value) {
      onSave?.(editValue);
    }
  }

  let items: LineItem[] = [];
  if (lineItemsJson) {
    try {
      items = JSON.parse(lineItemsJson) as LineItem[];
    } catch {
      // geen geldig JSON, val terug op platte tekst
    }
  }

  const hasStructured = items.length > 0;
  const displayText = value || "—";
  const canOpen = hasStructured || Boolean(value);

  return (
    <div ref={ref} className="relative">
      {editing ? (
        <textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitEdit();
            if (e.key === "Escape") { setEditing(false); setEditValue(value); }
          }}
          rows={4}
          className="w-full min-w-[12rem] border-0 bg-koopje-orange-light/20 px-2 py-1.5 text-sm text-stone-700 outline-none focus:ring-1 focus:ring-koopje-orange/50 resize-none"
          placeholder="Producten (één per regel)"
        />
      ) : (
        <div className="group flex items-start gap-1">
          <button
            type="button"
            onClick={() => { if (canOpen) setOpen((o) => !o); }}
            title={canOpen ? "Klik voor productoverzicht" : undefined}
            className={`min-w-0 flex-1 px-2 py-1.5 text-left text-sm text-stone-700 ${
              canOpen
                ? "cursor-pointer hover:bg-koopje-orange-light/40"
                : "cursor-default"
            }`}
          >
            <span className="line-clamp-2 leading-snug">{displayText}</span>
            {canOpen && (
              <span className="ml-1 inline-block align-middle text-[10px] text-koopje-orange opacity-70">
                ▾
              </span>
            )}
          </button>
          {onSave && (
            <button
              type="button"
              onClick={startEdit}
              title="Producten bewerken"
              className="shrink-0 mt-1 mr-1 rounded p-0.5 text-stone-300 opacity-0 transition group-hover:opacity-100 hover:bg-stone-100 hover:text-koopje-orange"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {open && canOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-stone-200 bg-white p-3 shadow-2xl"
          style={{ minWidth: "18rem" }}
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
            Productoverzicht
          </p>

          {hasStructured ? (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-3 py-2 ${
                    item.isFiets
                      ? "border-koopje-orange/30 bg-orange-50"
                      : "border-stone-200 bg-stone-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`text-sm font-semibold leading-snug ${
                        item.isFiets ? "text-koopje-orange" : "text-stone-700"
                      }`}
                    >
                      {item.isFiets && (
                        <span className="mr-1 text-[10px]">🚲</span>
                      )}
                      {item.name}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-stone-400">
                      €{item.price.toFixed(2)}
                    </span>
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
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                        Standaard inbegrepen
                      </p>
                      <ul className="space-y-0.5">
                        {item.defaultItems.map((d, j) => (
                          <li key={j} className="flex items-center gap-1.5 text-xs text-stone-500">
                            <span className="text-[10px]">📦</span>
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Geen structured data – toon platte tekst keurig opgemaakt
            <div className="whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
              {value}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
