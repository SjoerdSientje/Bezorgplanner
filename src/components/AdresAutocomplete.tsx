"use client";

import { useEffect, useRef, useState } from "react";

export interface AdresVelden {
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
}

interface PdokDoc {
  id: string;
  weergavenaam?: string;
  straatnaam?: string;
  huisnummer?: number | string;
  huisletter?: string;
  huisnummertoevoeging?: string;
  postcode?: string;
  woonplaatsnaam?: string;
}

interface Props {
  velden: AdresVelden;
  onChange: (velden: AdresVelden) => void;
}

function formatHuisnummer(doc: PdokDoc): string {
  const num = String(doc.huisnummer ?? "").trim();
  const letter = String(doc.huisletter ?? "").trim();
  const toev = String(doc.huisnummertoevoeging ?? "").trim();
  return [num, letter, toev].filter(Boolean).join("");
}

function formatPostcode(raw: string | undefined): string {
  const p = String(raw ?? "").replace(/\s/g, "").toUpperCase();
  if (p.length === 6) return `${p.slice(0, 4)} ${p.slice(4)}`;
  return p;
}

const DEBOUNCE_MS = 280;
const MIN_QUERY_LEN = 3;
const PDOK_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";

export default function AdresAutocomplete({ velden, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<PdokDoc[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sluit dropdown bij klik buiten component
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
    const params = new URLSearchParams({
      q: query,
      "fq": "type:adres",
      rows: "8",
      fl: "id,weergavenaam,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam",
    });

    fetch(`${PDOK_URL}?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { response?: { docs?: PdokDoc[] } }) => {
        const docs = data?.response?.docs ?? [];
        setSuggestions(docs);
        setShowSuggestions(docs.length > 0);
        setActiveIndex(-1);
      })
      .catch(() => {
        setSuggestions([]);
        setShowSuggestions(false);
      })
      .finally(() => setLoading(false));
  }

  function handleStraatnaamChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange({ ...velden, straatnaam: val });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Combineer straatnaam + huisnummer voor betere resultaten als huisnummer al ingevuld is
      const query = velden.huisnummer.trim()
        ? `${val} ${velden.huisnummer.trim()}`
        : val;
      fetchSuggestions(query);
    }, DEBOUNCE_MS);
  }

  function handleHuisnummerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange({ ...velden, huisnummer: val });

    // Herlaad suggesties als straatnaam al ingetypt is
    if (velden.straatnaam.length >= MIN_QUERY_LEN) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(`${velden.straatnaam} ${val}`);
      }, DEBOUNCE_MS);
    }
  }

  function selectSuggestion(doc: PdokDoc) {
    const straatnaam = String(doc.straatnaam ?? "").trim();
    const huisnummer = formatHuisnummer(doc);
    const postcode = formatPostcode(doc.postcode);
    const woonplaats = String(doc.woonplaatsnaam ?? "").trim();
    onChange({ straatnaam, huisnummer, postcode, woonplaats });
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIndex(-1);
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
    <div className="space-y-3">
      {/* Straatnaam met autocomplete dropdown */}
      <div className="grid grid-cols-[1fr_6rem] gap-3" ref={containerRef}>
        <div>
          <label htmlFor="straatnaam" className="mb-1 block text-sm font-medium text-koopje-black">
            Straatnaam
          </label>
          <div className="relative">
            <input
              ref={inputRef}
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
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              </span>
            )}

            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute left-0 top-full z-50 mt-1 max-h-60 w-[calc(100%+6.5rem)] overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-xl">
                {suggestions.map((doc, idx) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSuggestion(doc);
                      }}
                      className={`w-full px-3 py-2.5 text-left text-sm transition ${
                        idx === activeIndex
                          ? "bg-koopje-orange-light text-koopje-black"
                          : "text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      <span className="font-medium">{doc.weergavenaam ?? ""}</span>
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
            placeholder="12B"
            className={inputCls}
          />
        </div>
      </div>

      {/* Postcode + Woonplaats */}
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <div>
          <label htmlFor="postcode" className="mb-1 block text-sm font-medium text-koopje-black">
            Postcode
          </label>
          <input
            id="postcode"
            type="text"
            value={velden.postcode}
            onChange={(e) => onChange({ ...velden, postcode: e.target.value })}
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
            value={velden.woonplaats}
            onChange={(e) => onChange({ ...velden, woonplaats: e.target.value })}
            placeholder="Amsterdam"
            className={inputCls}
          />
        </div>
      </div>
    </div>
  );
}
