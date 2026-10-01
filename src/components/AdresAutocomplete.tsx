"use client";

import { useEffect, useRef, useState } from "react";

export interface AdresVelden {
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
}

type PdokSuggestion = {
  id: string;
  label: string;
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
};

interface Props {
  velden: AdresVelden;
  onChange: (velden: AdresVelden) => void;
}

const DEBOUNCE_MS = 280;
const MIN_QUERY_LEN = 3;

export default function AdresAutocomplete({ velden, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<PdokSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const veldenRef = useRef(velden);
  const fetchGenRef = useRef(0);

  useEffect(() => {
    veldenRef.current = velden;
  }, [velden]);

  /** Direct ref bijwerken zodat snelle toetsaanslagen/selectie geen velden wissen. */
  function pushVelden(next: AdresVelden) {
    veldenRef.current = next;
    onChange(next);
  }

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
      return;
    }

    const gen = ++fetchGenRef.current;
    setLoading(true);

    fetch(`/api/pdok/adres?q=${encodeURIComponent(q)}`)
      .then((res) => res.json())
      .then((data: { suggestions?: PdokSuggestion[] }) => {
        if (gen !== fetchGenRef.current) return;
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        setShowSuggestions(list.length > 0);
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

  function buildQuery(patch: Partial<AdresVelden>): string {
    const v = { ...veldenRef.current, ...patch };
    const streetPart = [v.straatnaam.trim(), v.huisnummer.trim()]
      .filter(Boolean)
      .join(" ");
    const pc = v.postcode.trim();
    const place = v.woonplaats.trim();
    return [streetPart, pc, place].filter(Boolean).join(" ").trim();
  }

  function handleStraatnaamChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    pushVelden({ ...veldenRef.current, straatnaam: val });
    scheduleFetch(buildQuery({ straatnaam: val }));
  }

  function handleHuisnummerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    pushVelden({ ...veldenRef.current, huisnummer: val });
    if (
      veldenRef.current.straatnaam.trim().length >= MIN_QUERY_LEN ||
      val.trim().length >= 1
    ) {
      scheduleFetch(buildQuery({ huisnummer: val }));
    }
  }

  function handlePostcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    pushVelden({ ...veldenRef.current, postcode: val });
    const compact = val.replace(/\s/g, "");
    if (compact.length >= 4) {
      scheduleFetch(buildQuery({ postcode: val }));
    }
  }

  function handleWoonplaatsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    pushVelden({ ...veldenRef.current, woonplaats: val });
    if (
      veldenRef.current.straatnaam.trim().length >= MIN_QUERY_LEN ||
      val.trim().length >= MIN_QUERY_LEN
    ) {
      scheduleFetch(buildQuery({ woonplaats: val }));
    }
  }

  function selectSuggestion(item: PdokSuggestion) {
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);
    pushVelden({
      straatnaam: item.straatnaam,
      huisnummer: item.huisnummer,
      postcode: item.postcode,
      woonplaats: item.woonplaats,
    });
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
      selectSuggestion(suggestions[activeIndex]!);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/30 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange";

  return (
    <div className="space-y-3" ref={containerRef}>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <div>
          <label htmlFor="straatnaam" className="mb-1 block text-sm font-medium text-koopje-black">
            Straatnaam
          </label>
          <div className="relative">
            <input
              id="straatnaam"
              type="text"
              autoComplete="off"
              value={velden.straatnaam}
              onChange={handleStraatnaamChange}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              placeholder="Hoofdstraat"
              className={inputCls}
            />
            {loading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300">
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
              <ul className="absolute left-0 top-full z-50 mt-1 max-h-60 w-[calc(100%+6.5rem)] overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-xl">
                {suggestions.map((item, idx) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSuggestion(item);
                      }}
                      className={`w-full px-3 py-2.5 text-left text-sm transition ${
                        idx === activeIndex
                          ? "bg-koopje-orange-light text-koopje-black"
                          : "text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="huisnummer" className="mb-1 block text-sm font-medium text-koopje-black">
            Huisnummer
          </label>
          <input
            id="huisnummer"
            type="text"
            autoComplete="off"
            value={velden.huisnummer}
            onChange={handleHuisnummerChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            placeholder="12B"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <div>
          <label htmlFor="postcode" className="mb-1 block text-sm font-medium text-koopje-black">
            Postcode
          </label>
          <input
            id="postcode"
            type="text"
            autoComplete="off"
            value={velden.postcode}
            onChange={handlePostcodeChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            placeholder="1234 AB"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="woonplaats" className="mb-1 block text-sm font-medium text-koopje-black">
            Woonplaats
          </label>
          <input
            id="woonplaats"
            type="text"
            autoComplete="off"
            value={velden.woonplaats}
            onChange={handleWoonplaatsChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            placeholder="Amsterdam"
            className={inputCls}
          />
        </div>
      </div>
    </div>
  );
}
