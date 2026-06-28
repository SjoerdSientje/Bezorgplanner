"use client";

import { useEffect, useState } from "react";

type Direction = "inkomend" | "uitgaand";
type Step = "direction" | "pick" | "review" | "done";

type SearchResult = {
  inventory_product_id: string | null;
  title: string;
  stock_quantity: number | null;
};

type CartItem = {
  productId: string;
  title: string;
  quantity: number;
  stock: number | null;
};

export default function ScanPage() {
  const [step, setStep] = useState<Step>("direction");
  const [direction, setDirection] = useState<Direction>("uitgaand");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/inventory/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults((data.results ?? []).filter((r: SearchResult) => r.inventory_product_id));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const addToCart = (r: SearchResult) => {
    if (!r.inventory_product_id) return;
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === r.inventory_product_id);
      if (existing) {
        return prev.map((c) =>
          c.productId === r.inventory_product_id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          productId: r.inventory_product_id!,
          title: r.title,
          quantity: 1,
          stock: r.stock_quantity,
        },
      ];
    });
    setQuery("");
    setResults([]);
  };

  const updateQty = (productId: string, quantity: number) => {
    setCart((prev) =>
      prev.map((c) =>
        c.productId === productId ? { ...c, quantity: Math.max(1, quantity) } : c
      )
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((c) => c.productId !== productId));
  };

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          items: cart.map((c) => ({ productId: c.productId, quantity: c.quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Bevestigen mislukt");
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bevestigen mislukt");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep("direction");
    setCart([]);
    setQuery("");
    setError(null);
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col px-4 py-6">
      <h1 className="text-center text-xl font-bold text-koopje-black">Voorraad scan</h1>

      {step === "direction" && (
        <div className="mt-8 flex flex-1 flex-col gap-4">
          <p className="text-center text-sm text-stone-600">Kies type mutatie</p>
          <button
            type="button"
            onClick={() => {
              setDirection("inkomend");
              setStep("pick");
            }}
            className="rounded-2xl bg-green-600 py-6 text-lg font-semibold text-white shadow-md active:scale-[0.98]"
          >
            + Inkomend
          </button>
          <button
            type="button"
            onClick={() => {
              setDirection("uitgaand");
              setStep("pick");
            }}
            className="rounded-2xl bg-koopje-orange py-6 text-lg font-semibold text-white shadow-md active:scale-[0.98]"
          >
            − Uitgaand
          </button>
        </div>
      )}

      {step === "pick" && (
        <div className="mt-6 flex flex-1 flex-col">
          <p className="mb-2 text-center text-sm font-medium text-stone-600 capitalize">{direction}</p>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek product…"
            className="w-full rounded-xl border border-stone-200 bg-white px-4 py-4 text-base shadow-sm"
            autoFocus
          />
          {searching && <p className="mt-2 text-center text-xs text-stone-400">Zoeken in Shopify…</p>}
          {results.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-sm">
              {results.map((r) => (
                <li key={r.inventory_product_id}>
                  <button
                    type="button"
                    onClick={() => addToCart(r)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm active:bg-stone-50"
                  >
                    <span>{r.title}</span>
                    <span className="text-stone-400">voorraad {r.stock_quantity ?? "?"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {cart.length > 0 && (
            <div className="mt-4 flex-1">
              <h2 className="text-sm font-semibold text-stone-700">Geselecteerd ({cart.length})</h2>
              <ul className="mt-2 space-y-2">
                {cart.map((c) => (
                  <li
                    key={c.productId}
                    className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="text-xs text-stone-400">voorraad {c.stock ?? "?"}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateQty(c.productId, c.quantity - 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 text-lg"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-semibold">{c.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(c.productId, c.quantity + 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 text-lg"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(c.productId)}
                      className="text-xs text-red-500"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setStep("direction")}
              className="flex-1 rounded-xl border border-stone-200 py-4 text-sm font-medium"
            >
              Terug
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setStep("review")}
              className="flex-1 rounded-xl bg-koopje-black py-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              Bevestigen
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="mt-6 flex flex-1 flex-col">
          <h2 className="text-lg font-semibold">Overzicht</h2>
          <p className="text-sm capitalize text-stone-600">{direction}</p>
          <ul className="mt-4 space-y-2">
            {cart.map((c) => (
              <li key={c.productId} className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
                <span className="font-medium">{c.title}</span>
                <span className="float-right font-semibold">× {c.quantity}</span>
              </li>
            ))}
          </ul>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-auto flex gap-3 pt-6">
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="flex-1 rounded-xl border border-stone-200 py-4 text-sm font-medium"
            >
              Terug
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={confirm}
              className="flex-1 rounded-xl bg-koopje-orange py-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Bezig…" : "Ja, bevestigen"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="mt-12 flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700">
            ✓
          </div>
          <p className="mt-4 text-lg font-semibold">Voorraad bijgewerkt</p>
          <button
            type="button"
            onClick={reset}
            className="mt-8 w-full rounded-xl bg-koopje-black py-4 text-sm font-semibold text-white"
          >
            Nieuwe mutatie
          </button>
        </div>
      )}
    </main>
  );
}
