"use client";

import { useState } from "react";

type CheckState = {
  paused: boolean;
  activeMpOrderCount: number;
};

export default function MpNoodschakelaarPage() {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<CheckState | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const reset = () => {
    setCheckState(null);
    setResult(null);
    setError(null);
  };

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/mp-noodschakelaar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, action: "check" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Onjuist wachtwoord.");
      setCheckState({ paused: Boolean(data.paused), activeMpOrderCount: Number(data.activeMpOrderCount ?? 0) });
    } catch (e) {
      setCheckState(null);
      setError(e instanceof Error ? e.message : "Onjuist wachtwoord.");
    } finally {
      setChecking(false);
    }
  };

  const handleToggleConfirm = async () => {
    setToggling(true);
    setError(null);
    try {
      const res = await fetch("/api/mp-noodschakelaar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, action: "toggle" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Actie mislukt.");
      const nowPaused = Boolean(data.paused);
      setResult(
        nowPaused
          ? "MP-orders zijn nu verborgen: niet-afgeronde MP-orders verschijnen nergens meer in de Bezorgplanner (ritjes, planning, route genereren, appjes), en de pagina \"MP orders\" is verborgen. Er is niets verwijderd."
          : "MP-orders zijn weer zichtbaar: alles werkt weer zoals normaal."
      );
      setCheckState(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie mislukt.");
    } finally {
      setToggling(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-koopje-black">MP-veiligheidsschakelaar</h1>
        <p className="mt-1 text-sm text-stone-500">
          Verbergt (aan/uit) alle niet-afgeronde MP-orders overal in de Bezorgplanner en de
          pagina &quot;MP orders&quot;. Er wordt nooit iets verwijderd.
        </p>

        {!result && (
          <>
            <label className="mt-5 block text-xs font-medium text-stone-500">Wachtwoord</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                reset();
              }}
              autoFocus
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !checkState) handleCheck();
              }}
            />

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            {!checkState && (
              <button
                type="button"
                onClick={handleCheck}
                disabled={checking || password.length === 0}
                className="mt-4 w-full rounded-xl bg-koopje-orange px-4 py-2.5 text-sm font-medium text-white hover:bg-koopje-orange/90 disabled:opacity-50"
              >
                {checking ? "Controleren…" : "Controleren"}
              </button>
            )}

            {checkState && (
              <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm text-koopje-black">
                  Huidige status:{" "}
                  <span className="font-semibold">
                    {checkState.paused ? "MP-orders zijn verborgen" : "MP-orders zijn zichtbaar (normaal)"}
                  </span>
                </p>
                <p className="mt-2 text-sm text-stone-600">
                  Er {checkState.activeMpOrderCount === 1 ? "is" : "zijn"} nu{" "}
                  <span className="font-semibold">{checkState.activeMpOrderCount}</span> niet-afgeronde
                  MP-order{checkState.activeMpOrderCount === 1 ? "" : "s"} in het systeem.
                </p>
                <p className="mt-3 text-sm font-medium text-koopje-black">
                  Weet je zeker dat je{" "}
                  {checkState.paused
                    ? "MP-orders weer wilt tonen (alles weer normaal zichtbaar maken)?"
                    : "alle niet-afgeronde MP-orders en de MP orders-pagina wilt verbergen?"}
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCheckState(null)}
                    className="flex-1 rounded-xl border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100"
                  >
                    Annuleren
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleConfirm}
                    disabled={toggling}
                    className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {toggling ? "Bezig…" : checkState.paused ? "Ja, weer tonen" : "Ja, verbergen"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {result && (
          <div className="mt-5">
            <p className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-koopje-black">
              {result}
            </p>
            <button
              type="button"
              onClick={() => {
                setPassword("");
                setResult(null);
              }}
              className="mt-4 w-full rounded-xl border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100"
            >
              Terug
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
