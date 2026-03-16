"use client";

import { useState, useRef, useEffect } from "react";

type GoedkeurenMode = "replace" | "morgen";

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
        onBlur={(e) => { if (!e.target.value.trim()) onChange("10:30"); }}
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
              onClick={() => { onChange(t); setOpen(false); }}
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
}

export default function RitjesRouteControls({ onRouteGenerated }: Props) {
  const [vertrektijd, setVertrektijd] = useState("10:30");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // Planning goedkeuren
  const [showDialog, setShowDialog] = useState(false);
  const [goedkeurenLoading, setGoedkeurenLoading] = useState(false);
  const [goedkeurenMessage, setGoedkeurenMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  async function handleRouteGenereren() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routific/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertrektijd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Route kon niet worden gegenereerd." });
        return;
      }
      setMessage({ type: "ok", text: data.message || "Route gegenereerd." });
      onRouteGenerated?.();
    } catch {
      setMessage({ type: "error", text: "Er ging iets mis. Probeer het opnieuw." });
    } finally {
      setLoading(false);
    }
  }

  async function submitGoedkeuren(mode: GoedkeurenMode) {
    setShowDialog(false);
    setGoedkeurenLoading(true);
    setGoedkeurenMessage(null);
    try {
      const res = await fetch("/api/planning-goedkeuren", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoedkeurenMessage({ type: "error", text: data.error || "Goedkeuren mislukt." });
        return;
      }
      setGoedkeurenMessage({ type: "ok", text: data.message || "Planning goedgekeurd." });
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
            <TijdPicker value={vertrektijd} onChange={setVertrektijd} />
          </div>
          <button
            type="button"
            onClick={handleRouteGenereren}
            disabled={loading}
            className="rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
          >
            {loading ? "Bezig…" : "Route genereren"}
          </button>
          {message && (
            <p className={`w-full text-sm sm:w-auto ${message.type === "error" ? "text-red-600" : "text-green-700"}`}>
              {message.text}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => { setShowDialog(true); setGoedkeurenMessage(null); }}
            disabled={goedkeurenLoading}
            className="rounded-lg border border-koopje-orange bg-white px-4 py-2 text-sm font-medium text-koopje-orange transition hover:bg-koopje-orange-light disabled:opacity-50"
          >
            {goedkeurenLoading ? "Bezig…" : "Planning goedkeuren"}
          </button>
          {goedkeurenMessage && (
            <p className={`w-full text-sm sm:w-auto ${goedkeurenMessage.type === "error" ? "text-red-600" : "text-green-700"}`}>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="mb-2 text-base font-semibold text-koopje-black">
                Planning goedkeuren
              </h2>
              <p className="mb-5 text-sm text-koopje-black/70">
                Er zijn mogelijk ritjes die al bezig zijn. Wat wil je doen?
              </p>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => submitGoedkeuren("replace")}
                  className="w-full rounded-xl bg-koopje-orange px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-koopje-orange-dark"
                >
                  <span className="block font-semibold">Planning vervangen</span>
                  <span className="block text-xs font-normal text-white/80">
                    De huidige planning wordt volledig vervangen door de nieuwe route.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => submitGoedkeuren("morgen")}
                  className="w-full rounded-xl border border-koopje-orange px-4 py-3 text-left text-sm font-medium text-koopje-orange transition hover:bg-koopje-orange-light"
                >
                  <span className="block font-semibold">Ritjes voor morgen toevoegen</span>
                  <span className="block text-xs font-normal text-koopje-black/60">
                    Huidige ritjes blijven staan. De nieuwe route verschijnt als aparte sectie.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDialog(false)}
                  className="w-full rounded-xl px-4 py-2 text-sm text-koopje-black/60 transition hover:text-koopje-black"
                >
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
