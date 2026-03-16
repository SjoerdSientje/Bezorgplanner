"use client";

import { useState } from "react";

type GoedkeurenMode = "replace" | "morgen";

// Tijdopties per 15 minuten van 07:00 t/m 20:00
const TIJDOPTIES: string[] = [];
for (let h = 7; h <= 20; h++) {
  for (const m of [0, 15, 30, 45]) {
    TIJDOPTIES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
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
            <select
              id="vertrektijd"
              value={TIJDOPTIES.includes(vertrektijd) ? vertrektijd : TIJDOPTIES[0]}
              onChange={(e) => setVertrektijd(e.target.value)}
              className="rounded-lg border border-koopje-black/20 px-3 py-2 text-sm text-koopje-black focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
            >
              {TIJDOPTIES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
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
