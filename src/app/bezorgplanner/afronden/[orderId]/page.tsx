"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";

type PaymentOption =
  | "Was al betaald"
  | "Factuur betaling aan deur"
  | "Contant aan deur"
  | "Anders";

interface LineItemFromJson {
  name: string;
  isFiets: boolean;
  defaultItems?: string[];
}

type OrderDetail = {
  id: string;
  volledig_adres?: string | null;
  producten?: string | null;
  line_items_json?: string | null;
};

function shouldIgnoreAfrondenChecklistItem(label: string): boolean {
  const n = label.trim().toLowerCase();
  if (!n) return true;
  // Alleen echte producten; geen levering/montage labels
  if (n === "volledig rijklaar") return true;
  if (n === "rijklaar") return true;
  if (n === "in doos") return true;
  return false;
}

function parseChecklist(order: OrderDetail): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  const add = (s: string) => {
    const key = s.trim();
    if (!key) return;
    if (shouldIgnoreAfrondenChecklistItem(key)) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  const raw = order.line_items_json;
  if (raw) {
    try {
      const items = JSON.parse(raw) as LineItemFromJson[];
      for (const item of items) {
        if (item.isFiets) {
          add(item.name);
          for (const d of item.defaultItems ?? []) add(d);
        } else {
          add(item.name);
        }
      }
    } catch {
      // fall through to producten text
    }
  }

  if (counts.size === 0 && order.producten) {
    // Fallback: newline-separated producten
    for (const line of String(order.producten).split("\n")) add(line);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b, "nl"))
    .map(([label, count]) => ({ label, count }));
}

export default function AfrondenVragenlijstPage({
  params,
}: {
  params: { orderId: string };
}) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const BEZORGER_OPTIES = ["Tristan", "Eef", "Silas"] as const;
  const [bezorgerKeuze, setBezorgerKeuze] = useState<string>("");
  const [bezorgerAnders, setBezorgerAnders] = useState("");
  const bezorgerNaam =
    bezorgerKeuze === "Anders" ? bezorgerAnders.trim() : bezorgerKeuze;
  const [betaalOptie, setBetaalOptie] = useState<PaymentOption | "">("");
  const [betaalAnders, setBetaalAnders] = useState("");
  const [betaalBedrag, setBetaalBedrag] = useState<string>("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${params.orderId}?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Ophalen mislukt");
      setOrder(data.order as OrderDetail);
    } catch (e) {
      setOrder(null);
      setError(e instanceof Error ? e.message : "Ophalen mislukt");
    } finally {
      setLoading(false);
    }
  }, [params.orderId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const checklist = useMemo(() => (order ? parseChecklist(order) : []), [order]);

  // Init checked-state zodra checklist binnen is
  useEffect(() => {
    if (!checklist.length) return;
    setChecked((prev) => {
      const next = { ...prev };
      for (const item of checklist) {
        if (next[item.label] === undefined) next[item.label] = false;
      }
      return next;
    });
  }, [checklist]);

  const allChecked = checklist.every((i) => checked[i.label]);
  const needsBedrag = betaalOptie === "Factuur betaling aan deur" || betaalOptie === "Contant aan deur";
  const bedragOk = !needsBedrag || (betaalBedrag.trim().length > 0 && !Number.isNaN(Number(betaalBedrag)));
  const paymentOk =
    Boolean(betaalOptie) && (betaalOptie !== "Anders" || betaalAnders.trim().length > 0) && bedragOk;
  const canSubmit = bezorgerNaam.trim().length > 0 && paymentOk && allChecked && !saving;

  const submit = useCallback(async () => {
    if (!order) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/afronden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          bezorger_naam: bezorgerNaam,
          betaal_optie: betaalOptie,
          betaal_anders: betaalAnders,
          betaal_bedrag: needsBedrag ? Number(betaalBedrag) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Afronden mislukt");
      if (data?.whatsapp?.ok === false) {
        throw new Error(`Order afgerond, maar WhatsApp mislukt: ${data?.whatsapp?.error ?? "onbekende fout"}`);
      }

      console.log("[afronden] API response debug:", data?.debug);
      // Hard redirect naar planning zodat de pagina volledig opnieuw laadt
      // en de afgeronde order zeker niet meer zichtbaar is.
      window.location.href = "/bezorgplanner/planning";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afronden mislukt");
    } finally {
      setSaving(false);
    }
  }, [order, bezorgerNaam, betaalOptie, betaalAnders, betaalBedrag, router]);

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/bezorgplanner/planning"
              className="text-koopje-black/60 transition hover:text-koopje-black"
              aria-label="Terug naar Planning"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
              Order afronden
            </h1>
          </div>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : !order ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error ?? "Order niet gevonden."}
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-koopje-black/80">
                Je handelt nu de order af voor{" "}
                <span className="font-semibold text-koopje-black">
                  {order.volledig_adres || "onbekend adres"}
                </span>
              </p>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-koopje-black">Naam bezorger</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([...BEZORGER_OPTIES, "Anders"] as string[]).map((opt) => (
                    <label
                      key={opt}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                        bezorgerKeuze === opt
                          ? "border-koopje-orange bg-koopje-orange-light/60 text-koopje-black"
                          : "border-stone-200 bg-white text-koopje-black/80 hover:bg-stone-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="bezorger"
                        className="accent-koopje-orange"
                        checked={bezorgerKeuze === opt}
                        onChange={() => setBezorgerKeuze(opt)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
                {bezorgerKeuze === "Anders" && (
                  <input
                    value={bezorgerAnders}
                    onChange={(e) => setBezorgerAnders(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-koopje-black outline-none focus:border-koopje-orange focus:ring-2 focus:ring-koopje-orange/20"
                    placeholder="Naam bezorger"
                    autoFocus
                  />
                )}
              </div>

              <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-koopje-black">
                  Hoe is er betaald?
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      "Was al betaald",
                      "Factuur betaling aan deur",
                      "Contant aan deur",
                      "Anders",
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                        betaalOptie === opt
                          ? "border-koopje-orange bg-koopje-orange-light/60 text-koopje-black"
                          : "border-stone-200 bg-white text-koopje-black/80 hover:bg-stone-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="betaaloptie"
                        className="accent-koopje-orange"
                        checked={betaalOptie === opt}
                        onChange={() => setBetaalOptie(opt)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
                {betaalOptie === "Anders" && (
                  <div className="mt-3">
                    <label className="mb-2 block text-sm font-semibold text-koopje-black">
                      Anders, namelijk
                    </label>
                    <input
                      value={betaalAnders}
                      onChange={(e) => setBetaalAnders(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-koopje-black outline-none focus:border-koopje-orange focus:ring-2 focus:ring-koopje-orange/20"
                      placeholder="Typ hier…"
                    />
                  </div>
                )}

                {needsBedrag && (
                  <div className="mt-3">
                    <label className="mb-2 block text-sm font-semibold text-koopje-black">
                      Bedrag
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={betaalBedrag}
                      onChange={(e) => setBetaalBedrag(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-koopje-black outline-none focus:border-koopje-orange focus:ring-2 focus:ring-koopje-orange/20"
                      placeholder="Bijv. 850"
                      min={0}
                      step={0.01}
                    />
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-koopje-black">
                  Alles meegegeven?
                </p>
                {checklist.length === 0 ? (
                  <p className="text-sm text-koopje-black/60">
                    Geen producten gevonden voor deze order.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {checklist.map((item) => (
                      <label
                        key={item.label}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 text-sm ${
                          checked[item.label]
                            ? "border-green-200 bg-green-50"
                            : "border-stone-200 bg-white hover:bg-stone-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-koopje-orange"
                          checked={Boolean(checked[item.label])}
                          onChange={(e) =>
                            setChecked((prev) => ({
                              ...prev,
                              [item.label]: e.target.checked,
                            }))
                          }
                        />
                        <div className="flex flex-1 items-start justify-between gap-3">
                          <span className="text-koopje-black">{item.label}</span>
                          {item.count > 1 && (
                            <span className="shrink-0 rounded-full bg-koopje-orange-light px-2 py-0.5 text-xs font-semibold text-koopje-orange">
                              {item.count}×
                            </span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="w-full rounded-2xl bg-koopje-orange px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-koopje-orange/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Afronden…" : "Order afronden"}
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
