"use client";

import { useEffect, useRef, useState } from "react";
import {
  splitMoneybirdAddress1,
  type MoneybirdContactFormFill,
  type MoneybirdContactSuggestion,
} from "@/lib/moneybird-contact-shared";

export type { MoneybirdContactFormFill };

type Props = {
  value: string;
  onChange: (email: string) => void;
  /** Vervangt alle klantvelden met de gekozen Moneybird-klant. */
  onSelectContact: (fill: MoneybirdContactFormFill) => void;
  className?: string;
};

const DEBOUNCE_MS = 280;
const MIN_QUERY_LEN = 2;

function suggestionToFill(item: MoneybirdContactSuggestion): MoneybirdContactFormFill {
  const { straatnaam, huisnummer } = splitMoneybirdAddress1(item.address1);
  const naam =
    item.companyName ||
    [item.firstname, item.lastname].filter(Boolean).join(" ").trim() ||
    item.displayName;
  return {
    email: item.email,
    naam,
    telefoon: item.phone,
    straatnaam,
    huisnummer,
    postcode: item.zipcode,
    woonplaats: item.city,
    source: item.source ?? "moneybird",
  };
}

export default function MoneybirdContactEmailAutocomplete({
  value,
  onChange,
  onSelectContact,
  className,
}: Props) {
  const [suggestions, setSuggestions] = useState<MoneybirdContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchGenRef = useRef(0);
  const focusedRef = useRef(false);
  /** Na selectie geen nieuwe zoekronde op dezelfde waarde. */
  const selectedEmailRef = useRef<string | null>(null);

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
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setShowSuggestions(false);
      setLoading(false);
      return;
    }
    if (
      selectedEmailRef.current &&
      selectedEmailRef.current.toLowerCase() === q.toLowerCase()
    ) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const gen = ++fetchGenRef.current;
    setLoading(true);
    fetch(`/api/moneybird/contacts?q=${encodeURIComponent(q)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { contacts?: MoneybirdContactSuggestion[] }) => {
        if (gen !== fetchGenRef.current) return;
        const list = Array.isArray(data.contacts) ? data.contacts : [];
        setSuggestions(list);
        setShowSuggestions(focusedRef.current && list.length > 0);
        setActiveIndex(-1);
      })
      .catch(() => {
        if (gen !== fetchGenRef.current) return;
        setSuggestions([]);
        setShowSuggestions(false);
      })
      .finally(() => {
        if (gen === fetchGenRef.current) setLoading(false);
      });
  }

  function scheduleFetch(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
  }

  function selectSuggestion(item: MoneybirdContactSuggestion) {
    selectedEmailRef.current = item.email;
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);
    onSelectContact(suggestionToFill(item));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    selectedEmailRef.current = null;
    onChange(next);
    scheduleFetch(next);
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

  return (
    <div ref={containerRef} className="relative">
      <input
        type="email"
        autoComplete="off"
        className={
          className ??
          "mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5"
        }
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          focusedRef.current = true;
          if (value.trim().length >= MIN_QUERY_LEN) fetchSuggestions(value);
        }}
        onBlur={() => {
          focusedRef.current = false;
          setShowSuggestions(false);
        }}
        placeholder="typ e-mail om klant te zoeken…"
      />
      {loading && (
        <span className="absolute right-3 top-[calc(50%+0.125rem)] -translate-y-1/2 text-stone-300">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8z"
            />
          </svg>
        </span>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-xl">
          {suggestions.map((item, idx) => (
            <li key={item.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(item);
                }}
                className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition ${
                  idx === activeIndex
                    ? "bg-koopje-orange-light text-koopje-black"
                    : "text-stone-700 hover:bg-stone-50"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium leading-snug">
                    {item.displayName}
                  </span>
                  {item.source === "mp" && (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-stone-400">
                      MP
                    </span>
                  )}
                </span>
                <span className="text-xs text-stone-500">{item.email}</span>
                {(item.city || item.zipcode || item.phone) && (
                  <span className="text-xs text-stone-400">
                    {[item.zipcode, item.city].filter(Boolean).join(" ")}
                    {item.phone
                      ? `${item.zipcode || item.city ? " · " : ""}${item.phone}`
                      : ""}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
