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

function formatPostcode(raw: string | undefined | null): string {
  const p = String(raw ?? "").replace(/\s/g, "").toUpperCase();
  if (p.length === 6) return `${p.slice(0, 4)} ${p.slice(4)}`;
  return p;
}

/**
 * Parst weergavenaam als fallback wanneer losse velden ontbreken.
 * Formaten: "Straat 12B, 1234 AB Amsterdam" / "Straat 1-G1, 1012NX Amsterdam" /
 * "Prinsengracht 263 HS, 1016GV Amsterdam"
 */
function parseWeergavenaam(s: string): Partial<AdresVelden> {
  const m = s.match(
    /^(.+?)\s+(\d[\w./-]*(?:\s+[A-Za-z]{1,4})?)\s*,\s*(\d{4}\s*[A-Z]{2})\s+(.+)$/i
  );
  if (m) {
    return {
      straatnaam: m[1].trim(),
      huisnummer: m[2].trim().replace(/\s+/g, ""),
      postcode: formatPostcode(m[3]),
      woonplaats: m[4].trim(),
    };
  }
  // Losse postcode uit weergavenaam halen als volledige parse faalt.
  const pc = s.match(/\b(\d{4}\s*[A-Z]{2})\b/i);
  if (!pc) return {};
  return { postcode: formatPostcode(pc[1]) };
}

function docToVelden(doc: PdokDoc): AdresVelden {
  let straatnaam = String(doc.straatnaam ?? "").trim();
  let huisnummer = formatHuisnummer(doc);
  let postcode = formatPostcode(doc.postcode);
  let woonplaats = String(doc.woonplaatsnaam ?? "").trim();

  if ((!postcode || !straatnaam || !woonplaats || !huisnummer) && doc.weergavenaam) {
    const parsed = parseWeergavenaam(doc.weergavenaam);
    straatnaam = straatnaam || parsed.straatnaam || "";
    huisnummer = huisnummer || parsed.huisnummer || "";
    postcode = postcode || parsed.postcode || "";
    woonplaats = woonplaats || parsed.woonplaats || "";
  }

  return { straatnaam, huisnummer, postcode, woonplaats };
}

function suggestionLabel(doc: PdokDoc): string {
  const pc = formatPostcode(doc.postcode);
  const straat = String(doc.straatnaam ?? "").trim();
  const huis = formatHuisnummer(doc);
  const plaats = String(doc.woonplaatsnaam ?? "").trim();
  if (straat && pc) {
    const head = [straat, huis].filter(Boolean).join(" ");
    return `${head}, ${pc}${plaats ? ` ${plaats}` : ""}`;
  }
  const weergave = String(doc.weergavenaam ?? "").trim();
  if (weergave) {
    // Zorg dat compacte postcode (1012JS) leesbaar wordt als die in de string zit.
    return weergave.replace(
      /\b(\d{4})([A-Z]{2})\b/gi,
      (_, n, l) => `${n} ${String(l).toUpperCase()}`
    );
  }
  return [straat, huis, plaats].filter(Boolean).join(" ");
}

const DEBOUNCE_MS = 280;
const MIN_QUERY_LEN = 3;
/** /free geeft losse velden (incl. postcode) betrouwbaarder terug dan /suggest. */
const PDOK_FREE = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
const PDOK_LOOKUP = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup";

async function lookupById(id: string): Promise<PdokDoc | null> {
  try {
    const res = await fetch(`${PDOK_LOOKUP}?id=${encodeURIComponent(id)}`);
    const data = (await res.json()) as { response?: { docs?: PdokDoc[] } };
    return data?.response?.docs?.[0] ?? null;
  } catch {
    return null;
  }
}

function mergeDoc(base: PdokDoc, full: PdokDoc | null): PdokDoc {
  if (!full) return base;
  return {
    ...base,
    ...full,
    postcode: full.postcode || base.postcode,
    straatnaam: full.straatnaam || base.straatnaam,
    woonplaatsnaam: full.woonplaatsnaam || base.woonplaatsnaam,
    weergavenaam: full.weergavenaam || base.weergavenaam,
  };
}

async function enrichMissingPostcodes(docs: PdokDoc[]): Promise<PdokDoc[]> {
  return Promise.all(
    docs.map(async (doc) => {
      if (formatPostcode(doc.postcode) || !doc.id) {
        // Ook uit weergavenaam halen als los veld ontbreekt.
        if (!formatPostcode(doc.postcode) && doc.weergavenaam) {
          const parsed = parseWeergavenaam(doc.weergavenaam);
          if (parsed.postcode) return { ...doc, postcode: parsed.postcode };
        }
        return doc;
      }
      const full = await lookupById(doc.id);
      const merged = mergeDoc(doc, full);
      if (!formatPostcode(merged.postcode) && merged.weergavenaam) {
        const parsed = parseWeergavenaam(merged.weergavenaam);
        if (parsed.postcode) return { ...merged, postcode: parsed.postcode };
      }
      return merged;
    })
  );
}

export default function AdresAutocomplete({ velden, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<PdokDoc[]>([]);
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
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const gen = ++fetchGenRef.current;
    setLoading(true);
    const params = new URLSearchParams({
      q,
      fq: "type:adres",
      rows: "8",
      fl: "id,weergavenaam,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam",
    });

    fetch(`${PDOK_FREE}?${params.toString()}`)
      .then((res) => res.json())
      .then(async (data: { response?: { docs?: PdokDoc[] } }) => {
        if (gen !== fetchGenRef.current) return;
        const docs = data?.response?.docs ?? [];
        const enriched = await enrichMissingPostcodes(docs);
        if (gen !== fetchGenRef.current) return;
        setSuggestions(enriched);
        setShowSuggestions(enriched.length > 0);
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
    // Postcode/woonplaats meegeven zodat PDOK resultaten mét postcode teruggeeft.
    return [streetPart, pc, place].filter(Boolean).join(" ").trim();
  }

  function handleStraatnaamChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange({ ...veldenRef.current, straatnaam: val });
    scheduleFetch(buildQuery({ straatnaam: val }));
  }

  function handleHuisnummerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange({ ...veldenRef.current, huisnummer: val });
    if (veldenRef.current.straatnaam.trim().length >= MIN_QUERY_LEN || val.trim().length >= 1) {
      scheduleFetch(buildQuery({ huisnummer: val }));
    }
  }

  function handlePostcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange({ ...veldenRef.current, postcode: val });
    const compact = val.replace(/\s/g, "");
    if (compact.length >= 4) {
      scheduleFetch(buildQuery({ postcode: val }));
    }
  }

  function handleWoonplaatsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange({ ...veldenRef.current, woonplaats: val });
    if (
      veldenRef.current.straatnaam.trim().length >= MIN_QUERY_LEN ||
      val.trim().length >= MIN_QUERY_LEN
    ) {
      scheduleFetch(buildQuery({ woonplaats: val }));
    }
  }

  async function selectSuggestion(doc: PdokDoc) {
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);

    // Direct toepassen (postcode zit al in /free) — niet wachten op lookup.
    onChange(docToVelden(doc));

    if (!doc.id) return;
    const looked = await lookupById(doc.id);
    if (!looked) return;
    onChange(docToVelden(mergeDoc(doc, looked)));
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
      void selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/30 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange";

  return (
    <div className="space-y-3" ref={containerRef}>
      {/* Straatnaam + Huisnummer met dropdown */}
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
                        void selectSuggestion(doc);
                      }}
                      className={`w-full px-3 py-2.5 text-left text-sm transition ${
                        idx === activeIndex
                          ? "bg-koopje-orange-light text-koopje-black"
                          : "text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      {suggestionLabel(doc)}
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

      {/* Postcode + Woonplaats */}
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
