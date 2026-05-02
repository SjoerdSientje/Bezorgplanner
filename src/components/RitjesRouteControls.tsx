"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const ROUTES_LS = "bezorgplanner.routes.v2";

export type RouteRow = { vertrektijd: string; maxFietsen: number };

function loadRoutesDefault(): RouteRow[] {
  if (typeof window === "undefined") {
    return [{ vertrektijd: "10:30", maxFietsen: 11 }];
  }
  try {
    const raw = localStorage.getItem(ROUTES_LS);
    if (raw) {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p) && p.length > 0) {
        const rows: RouteRow[] = [];
        for (const x of p) {
          const o = x as Record<string, unknown>;
          const vt = String(o.vertrektijd ?? "10:30").trim();
          const mf =
            typeof o.maxFietsen === "number"
              ? o.maxFietsen
              : parseInt(String(o.maxFietsen ?? "11"), 10);
          if (/^\d{1,2}:\d{2}$/.test(vt) && Number.isFinite(mf) && mf >= 1 && mf <= 99) {
            rows.push({ vertrektijd: vt, maxFietsen: mf });
          }
        }
        if (rows.length > 0) return rows;
      }
    }
  } catch {
    // ignore
  }
  return [{ vertrektijd: "10:30", maxFietsen: 11 }];
}

const TIJDOPTIES: string[] = [];
for (let h = 7; h <= 15; h++) {
  for (const m of [0, 15, 30, 45]) {
    if (h === 15 && m > 0) break;
    TIJDOPTIES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function TijdPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex items-center">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (!e.target.value.trim()) onChange("10:30");
        }}
        placeholder="10:30"
        className="w-20 rounded-l-lg border border-r-0 border-koopje-black/20 px-2 py-2 text-sm text-koopje-black focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-r-lg border border-koopje-black/20 bg-stone-50 px-2 py-2 text-koopje-black/60 hover:bg-stone-100"
        tabIndex={-1}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-28 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          {TIJDOPTIES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-koopje-orange-light ${value === t ? "bg-koopje-orange/10 font-semibold text-koopje-orange" : "text-koopje-black"}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  onRouteGenerated?: () => void;
  /** Vertrektijd rechtsboven (context Sientje); eerste route vult hier vaak mee in bij openen. */
  vertrektijd: string;
  onVertrektijdChange: (v: string) => void;
}

export default function RitjesRouteControls({
  onRouteGenerated,
  vertrektijd,
  onVertrektijdChange,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [routes, setRoutes] = useState<RouteRow[]>(() => loadRoutesDefault());

  const [goedkeurenLoading, setGoedkeurenLoading] = useState(false);
  const [goedkeurenMessage, setGoedkeurenMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setRoutes(loadRoutesDefault());
  }, []);

  const persistRoutes = useCallback((rows: RouteRow[]) => {
    setRoutes(rows);
    try {
      localStorage.setItem(ROUTES_LS, JSON.stringify(rows));
    } catch {
      // ignore
    }
  }, []);

  /** Alleen bij openen: eerste route syncen met het vertrek-contextveld (Sientje / gemiddelde start). */
  useEffect(() => {
    if (!showDialog) return;
    setRoutes((prev) => {
      if (prev.length === 0) return [{ vertrektijd: vertrektijd || "10:30", maxFietsen: 11 }];
      const next = [...prev];
      next[0] = { ...next[0], vertrektijd: vertrektijd || next[0].vertrektijd };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen trigger bij openen, niet bij typen in dialoog
  }, [showDialog]);

  async function handleRoutesBerekenen() {
    const cleaned = routes.filter((r) => r.vertrektijd.trim() && r.maxFietsen >= 1);
    if (cleaned.length === 0) {
      setMessage({
        type: "error",
        text: "Vul per route een vertrektijd en max. aantal fietsen in.",
      });
      return;
    }
    for (const r of cleaned) {
      if (!/^\d{1,2}:\d{2}$/.test(r.vertrektijd.trim())) {
        setMessage({ type: "error", text: `Ongeldige tijd: ${r.vertrektijd} (gebruik HH:MM).` });
        return;
      }
    }
    persistRoutes(cleaned);
    setShowDialog(false);
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routific/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routes: cleaned.map((r) => ({
            vertrektijd: r.vertrektijd.trim(),
            maxFietsen: r.maxFietsen,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Route kon niet worden gegenereerd." });
        return;
      }
      setMessage({ type: "ok", text: data.message || "Route berekend." });
      onRouteGenerated?.();
    } catch {
      setMessage({ type: "error", text: "Er ging iets mis. Probeer het opnieuw." });
    } finally {
      setLoading(false);
    }
  }

  async function submitGoedkeuren() {
    setGoedkeurenLoading(true);
    setGoedkeurenMessage(null);
    try {
      const res = await fetch("/api/planning-goedkeuren", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoedkeurenMessage({ type: "error", text: data.error || "Goedkeuren mislukt." });
        return;
      }
      const wa = data?.whatsapp;
      if (wa && typeof wa.sent === "number") {
        const suffix =
          wa.failed > 0
            ? ` Appjes: ${wa.sent} verzonden, ${wa.failed} mislukt.`
            : ` Appjes: ${wa.sent} verzonden.`;
        setGoedkeurenMessage({
          type: wa.failed > 0 ? "error" : "ok",
          text: (data.message || "Planning goedgekeurd.") + suffix,
        });
      } else {
        setGoedkeurenMessage({ type: "ok", text: data.message || "Planning goedgekeurd." });
      }
    } catch {
      setGoedkeurenMessage({ type: "error", text: "Er ging iets mis. Probeer het opnieuw." });
    } finally {
      setGoedkeurenLoading(false);
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-3">
        <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <label htmlFor="vertrektijd" className="text-sm font-medium text-koopje-black">
              Vertrektijd
            </label>
            <TijdPicker value={vertrektijd} onChange={onVertrektijdChange} />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowDialog(true);
              setMessage(null);
            }}
            disabled={loading}
            className="rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
          >
            {loading ? "Bezig…" : "Route genereren"}
          </button>
          {message && (
            <p
              className={`w-full text-sm sm:w-auto ${message.type === "error" ? "text-red-600" : "text-green-700"}`}
            >
              {message.text}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => {
              submitGoedkeuren();
              setGoedkeurenMessage(null);
            }}
            disabled={goedkeurenLoading}
            className="rounded-lg border border-koopje-orange bg-white px-4 py-2 text-sm font-medium text-koopje-orange transition hover:bg-koopje-orange-light disabled:opacity-50"
          >
            {goedkeurenLoading ? "Bezig…" : "Planning goedkeuren"}
          </button>
          {goedkeurenMessage && (
            <p
              className={`w-full text-sm sm:w-auto ${goedkeurenMessage.type === "error" ? "text-red-600" : "text-green-700"}`}
            >
              {goedkeurenMessage.text}
            </p>
          )}
        </div>
      </div>

      {showDialog && (
        <>
          <div
            className="fixed inset-0 z-40 bg-koopje-black/40"
            aria-hidden
            onClick={() => setShowDialog(false)}
          />
          <div className="fixed inset-0 z-50 flex max-h-[100dvh] items-center justify-center overflow-y-auto px-4 py-8">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="mb-2 text-base font-semibold text-koopje-black">Routes</h2>
              <p className="mb-4 text-sm text-koopje-black/70">
                Per route <strong>verplicht</strong>: vertrek vanaf Kapelweg en het maximum aantal fietsen dat tegelijk op die route past. Meerdere routes = parallel meer busjes; één route = één bus met jouw max. load. Opgeslagen op dit apparaat.
              </p>
              <div className="mb-4 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
                {routes.map((row, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-2"
                  >
                    <span className="text-xs font-medium text-stone-600">Route {i + 1}</span>
                    <TijdPicker
                      value={row.vertrektijd}
                      onChange={(v) => {
                        const next = [...routes];
                        next[i] = { ...next[i], vertrektijd: v };
                        setRoutes(next);
                      }}
                    />
                    <label className="flex items-center gap-1 text-sm text-koopje-black">
                      <span className="text-koopje-black/60">max.</span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={row.maxFietsen}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          const next = [...routes];
                          next[i] = {
                            ...next[i],
                            maxFietsen: Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1,
                          };
                          setRoutes(next);
                        }}
                        className="w-14 rounded border border-koopje-black/20 px-2 py-1 text-sm"
                      />
                      <span className="text-koopje-black/60">fietsen</span>
                    </label>
                    {routes.length > 1 && (
                      <button
                        type="button"
                        className="ml-auto text-xs text-red-600 hover:underline"
                        onClick={() => setRoutes(routes.filter((_, j) => j !== i))}
                      >
                        Verwijderen
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setRoutes((prev) => [...prev, { vertrektijd: vertrektijd || "10:30", maxFietsen: 11 }])
                }
                className="mb-4 w-full rounded-lg border border-dashed border-stone-300 py-2 text-sm text-koopje-black/70 hover:bg-stone-50"
              >
                + Route toevoegen
              </button>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowDialog(false)}
                  className="rounded-xl px-4 py-2 text-sm text-koopje-black/60 hover:text-koopje-black"
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  onClick={handleRoutesBerekenen}
                  disabled={loading}
                  className="rounded-xl bg-koopje-orange px-4 py-2 text-sm font-medium text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
                >
                  Route berekenen
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
