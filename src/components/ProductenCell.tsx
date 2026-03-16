"use client";

import { useState, useEffect, useRef } from "react";

interface LineItem {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
}

interface Props {
  /** Platte tekst-waarde voor het geval line_items_json ontbreekt */
  value: string;
  /** JSON-string zoals gegenereerd door buildLineItemsJson() */
  lineItemsJson?: string | null;
}

export default function ProductenCell({ value, lineItemsJson }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
      <button
        type="button"
        onClick={() => { if (canOpen) setOpen((o) => !o); }}
        title={canOpen ? "Klik voor productoverzicht" : undefined}
        className={`w-full px-2 py-1.5 text-left text-sm text-stone-700 ${
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
