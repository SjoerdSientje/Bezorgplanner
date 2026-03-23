"use client";

import { useMemo, useState } from "react";

export default function ResetWachtwoordPage() {
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Reset mislukt.");
      setMessage("Wachtwoord aangepast. Je kunt nu inloggen.");
      setTimeout(() => {
        window.location.href = "/login";
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset mislukt.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-koopje-black">Wachtwoord resetten</h1>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nieuw wachtwoord"
            required
            minLength={6}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-koopje-orange"
          />
          <button
            type="submit"
            disabled={loading || !token}
            className="w-full rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-60"
          >
            {loading ? "Bezig..." : "Opslaan"}
          </button>
        </form>
        {!token && <p className="mt-3 text-sm text-red-600">Geen geldige reset-token gevonden.</p>}
        {message && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}

