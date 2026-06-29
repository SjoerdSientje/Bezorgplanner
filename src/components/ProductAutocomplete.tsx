"use client";

import { useEffect, useRef, useState } from "react";

type SearchResult = {
  title: string;
  price: string | null;
  stock_quantity?: number | null;
  shopify_product_id?: number;
  shopify_variant_id?: number;
};

export type ProductAutocompleteMeta = {
  shopify_product_id?: number;
  shopify_variant_id?: number;
};

type SearchSource = "inventory" | "shopify";

interface Props {
  label: string;
  value: string;
  onChange: (naam: string, prijs?: string, meta?: ProductAutocompleteMeta) => void;
  placeholder?: string;
  required?: boolean;
  /** inventory = voorraadgroepen; shopify = live Shopify-producten (MP-orders). */
  searchSource?: SearchSource;
}

const DEBOUNCE_MS = 280;
const MIN_QUERY_LEN = 2;

export default function ProductAutocomplete({
  label,
  value,
  onChange,
  placeholder,
  required,
  searchSource = "inventory",
}: Props) {
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchPath =
    searchSource === "shopify" ? "/api/shopify/product-search" : "/api/inventory/search";

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function fetchSuggestions(query: string) {
    if (query.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoading(true);
    fetch(`${searchPath}?q=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((data: { results?: SearchResult[] }) => {
        const results = data?.results ?? [];
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setActiveIndex(-1);
      })
      .catch(() => {
        setSuggestions([]);
        setShowSuggestions(false);
      })
      .finally(() => setLoading(false));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), DEBOUNCE_MS);
  }

  function selectSuggestion(item: SearchResult) {
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);
    const prijs = item.price != null && item.price !== "" ? item.price : undefined;
    const meta: ProductAutocompleteMeta | undefined =
      item.shopify_product_id != null || item.shopify_variant_id != null
        ? {
            shopify_product_id: item.shopify_product_id,
            shopify_variant_id: item.shopify_variant_id,
          }
        : undefined;
    onChange(item.title, prijs, meta);

    if (prijs == null && searchSource === "inventory") {
      fetch(`/api/inventory/search?q=${encodeURIComponent(item.title)}`)
        .then((res) => res.json())
        .then((data: { results?: SearchResult[] }) => {
          const match =
            (data.results ?? []).find((r) => r.title === item.title) ?? (data.results ?? [])[0];
          if (match?.price) onChange(item.title, match.price, meta);
        })
        .catch(() => {});
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/30 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange";

  return (
    <div ref={containerRef}>
      <label className="mb-1 block text-sm font-medium text-koopje-black">
        {label}
        {required && <span className="ml-1 text-koopje-orange">*</span>}
      </label>
      <div className="relative">
        <input
          type="text"
          autoComplete="off"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
          }}
          placeholder={placeholder}
          className={inputCls}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          </span>
        )}

        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-xl">
            {suggestions.map((item, idx) => (
              <li key={`${item.shopify_variant_id ?? item.title}-${idx}`}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(item);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition ${
                    idx === activeIndex
                      ? "bg-koopje-orange-light text-koopje-black"
                      : "text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="shrink-0 text-xs text-stone-400">
                    {item.price != null && item.price !== "" ? `€${item.price}` : ""}
                    {searchSource === "inventory" && item.stock_quantity != null
                      ? ` · ${item.stock_quantity} op voorraad`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
