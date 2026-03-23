"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "forgot">("login");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Inloggen mislukt.");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inloggen mislukt.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Verzenden mislukt.");
      setMessage(json.message ?? "Als dit adres bestaat, is een resetmail verzonden.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-koopje-black">Inloggen</h1>
        <p className="mt-1 text-sm text-koopje-black/60">Bezorgplanner · KoopjeFatbike</p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-lg px-3 py-1.5 text-sm ${mode === "login" ? "bg-koopje-orange text-white" : "bg-stone-100 text-stone-600"}`}
          >
            Inloggen
          </button>
          <button
            type="button"
            onClick={() => setMode("forgot")}
            className={`rounded-lg px-3 py-1.5 text-sm ${mode === "forgot" ? "bg-koopje-orange text-white" : "bg-stone-100 text-stone-600"}`}
          >
            Wachtwoord vergeten
          </button>
        </div>

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="mt-4 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-koopje-orange"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Wachtwoord"
              required
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-koopje-orange"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-60"
            >
              {loading ? "Bezig..." : "Inloggen"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="mt-4 space-y-3">
            <input
              type="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-koopje-orange"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-60"
            >
              {loading ? "Bezig..." : "Resetmail sturen"}
            </button>
          </form>
        )}

        {message && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}

