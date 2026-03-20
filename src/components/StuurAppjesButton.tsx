"use client";

import { useCallback, useMemo, useState } from "react";

type AppjesOrder = {
  slot_id: string;
  order_id: string;
  volgorde: number;
  order_nummer: string;
  naam: string;
  aankomsttijd_slot: string;
  telefoon_e164: string;
  telefoon_nummer: string;
  bezorgtijd_voorkeur: string;
};

type SendResult = {
  ok: boolean;
  message?: string;
  error?: string;
};

type CurrentRitjesOrder = {
  id?: string;
  aankomsttijd_slot?: string | null;
  order_nummer?: string | null;
  naam?: string | null;
  telefoon_e164?: string | null;
  telefoon_nummer?: string | null;
  bezorgtijd_voorkeur?: string | null;
};

type Props = {
  huidigeRitjesOrders?: CurrentRitjesOrder[];
  onBeforeOpen?: () => Promise<void>;
};

export default function StuurAppjesButton({ huidigeRitjesOrders, onBeforeOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<AppjesOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const currentByOrderId = useMemo(() => {
    const m = new Map<string, CurrentRitjesOrder>();
    for (const o of huidigeRitjesOrders ?? []) {
      const id = o?.id;
      if (!id) continue;
      m.set(id, o);
    }
    return m;
  }, [huidigeRitjesOrders]);

  function mergeLatestWithCurrent(apiOrders: AppjesOrder[]): AppjesOrder[] {
    if (!huidigeRitjesOrders?.length) return apiOrders;
    return apiOrders.map((o) => {
      const cur = currentByOrderId.get(o.order_id);
      if (!cur) return o;
      return {
        ...o,
        aankomsttijd_slot:
          cur.aankomsttijd_slot != null && String(cur.aankomsttijd_slot).trim() !== ""
            ? String(cur.aankomsttijd_slot)
            : o.aankomsttijd_slot,
        order_nummer: cur.order_nummer != null ? String(cur.order_nummer) : o.order_nummer,
        naam: cur.naam != null ? String(cur.naam) : o.naam,
        telefoon_e164: cur.telefoon_e164 != null ? String(cur.telefoon_e164) : o.telefoon_e164,
        telefoon_nummer: cur.telefoon_nummer != null ? String(cur.telefoon_nummer) : o.telefoon_nummer,
        bezorgtijd_voorkeur:
          cur.bezorgtijd_voorkeur != null ? String(cur.bezorgtijd_voorkeur) : o.bezorgtijd_voorkeur,
      };
    });
  }

  const openDialog = useCallback(async () => {
    setResult(null);
    setSelected(new Set());
    setLoadingOrders(true);
    setOpen(true);
    try {
      // Eerst wachten tot de "Ritjes voor vandaag" state + DB weer up-to-date is
      // (belangrijk als jij net een tijdslot hebt aangepast).
      if (onBeforeOpen) await onBeforeOpen();
      // Kleine extra marge zodat eventuele in-flight PATCH ook klaar kan zijn.
      await new Promise((r) => setTimeout(r, 250));

      const fetchFresh = async () => {
        const res = await fetch(`/api/planning-orders-appjes?t=${Date.now()}`, {
          cache: "no-store",
        });
        return res.json().catch(() => ({}));
      };

      // Eerst fetchen (mogelijk terwijl PATCH nog in-flight is),
      // daarna 1 korte retry om zeker te zijn dat het nieuwste tijdslot zichtbaar is.
      const data1: any = await fetchFresh();
      setOrders(mergeLatestWithCurrent(data1.orders ?? []));

      await new Promise((r) => setTimeout(r, 500));
      const data2: any = await fetchFresh();
      setOrders(mergeLatestWithCurrent(data2.orders ?? []));
    } catch {
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }, [onBeforeOpen, huidigeRitjesOrders, currentByOrderId]);

  function toggleOrder(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === orders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map((o) => o.order_id)));
    }
  }

  async function handleVerstuur() {
    if (selected.size === 0) return;
    setSending(true);
    setResult(null);
    try {
      // Herlaad net vóór verzending zodat we altijd het laatste tijdslot sturen
      const latestRes = await fetch(
        `/api/planning-orders-appjes?t=${Date.now()}`,
        { cache: "no-store" }
      );
      const latestData = await latestRes.json().catch(() => ({}));
      const latestOrders: AppjesOrder[] = mergeLatestWithCurrent(latestData.orders ?? orders);

      const payload = orders
        .filter((o) => selected.has(o.order_id))
        .map((o) => o); // keep reference
      const payloadLatest = latestOrders
        .filter((o) => selected.has(o.order_id))
        .map((o) => ({
          order_id: o.order_id,
          slot_id: o.slot_id,
          order_nummer: o.order_nummer,
          naam: o.naam,
          aankomsttijd_slot: o.aankomsttijd_slot,
          telefoon_e164: o.telefoon_e164,
          telefoon_nummer: o.telefoon_nummer,
        }));

      const res = await fetch("/api/stuur-appjes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: payloadLatest }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? "Versturen mislukt." });
      } else {
        setResult({ ok: true, message: data.message ?? "Appjes verstuurd." });
        setSelected(new Set());
      }
    } catch {
      setResult({ ok: false, error: "Er ging iets mis. Probeer het opnieuw." });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-2 rounded-lg border border-koopje-black/20 bg-white px-4 py-2 text-sm font-medium text-koopje-black transition hover:border-koopje-orange hover:text-koopje-orange focus:outline-none focus:ring-2 focus:ring-koopje-orange"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        Stuur appjes
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-koopje-black/40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" style={{ maxHeight: "85vh" }}>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-koopje-black/10 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-koopje-black">Stuur appjes</h2>
                  <p className="text-xs text-koopje-black/60">
                    Selecteer de orders met een nieuw tijdslot
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-koopje-black/50 hover:bg-koopje-black/5 hover:text-koopje-black"
                  aria-label="Sluiten"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {loadingOrders ? (
                  <p className="text-sm text-koopje-black/60">Laden…</p>
                ) : orders.length === 0 ? (
                  <p className="text-sm text-koopje-black/60">
                    Er zijn geen orders in de huidige planning (vandaag).
                  </p>
                ) : (
                  <>
                    {/* Selecteer alles */}
                    <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-lg border border-koopje-black/10 px-3 py-2 text-sm hover:bg-koopje-black/5">
                      <input
                        type="checkbox"
                        checked={selected.size === orders.length && orders.length > 0}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded accent-koopje-orange"
                      />
                      <span className="font-medium text-koopje-black">
                        Alles selecteren
                      </span>
                    </label>

                    <div className="space-y-2">
                      {orders.map((o) => (
                        <label
                          key={o.order_id}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                            selected.has(o.order_id)
                              ? "border-koopje-orange bg-koopje-orange-light/40"
                              : "border-koopje-black/10 hover:border-koopje-orange/40 hover:bg-koopje-black/5"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(o.order_id)}
                            onChange={() => toggleOrder(o.order_id)}
                            className="mt-0.5 h-4 w-4 rounded accent-koopje-orange"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-koopje-black text-sm">
                                {o.naam || "Onbekend"}
                              </span>
                              <span className="rounded bg-koopje-black/10 px-1.5 py-0.5 text-xs text-koopje-black/60">
                                {o.order_nummer}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-koopje-black/60">
                              <span>
                                <span className="font-medium text-koopje-black/80">Tijdslot:</span>{" "}
                                {o.aankomsttijd_slot || <em>geen</em>}
                              </span>
                              {o.telefoon_e164 && (
                                <span>
                                  <span className="font-medium text-koopje-black/80">Tel:</span>{" "}
                                  {o.telefoon_e164}
                                </span>
                              )}
                              {!o.telefoon_e164 && o.telefoon_nummer && (
                                <span className="text-amber-600">Geen E.164 nummer</span>
                              )}
                              {!o.telefoon_e164 && !o.telefoon_nummer && (
                                <span className="text-red-500">Geen telefoonnummer</span>
                              )}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {result && (
                  <p
                    className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                      result.ok
                        ? "bg-green-50 text-green-800"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {result.ok ? result.message : result.error}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-koopje-black/10 px-5 py-3 flex items-center justify-between gap-3">
                <span className="text-xs text-koopje-black/50">
                  {selected.size} geselecteerd
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-4 py-2 text-sm text-koopje-black/60 transition hover:text-koopje-black"
                  >
                    Sluiten
                  </button>
                  <button
                    type="button"
                    onClick={handleVerstuur}
                    disabled={selected.size === 0 || sending}
                    className="rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
                  >
                    {sending ? "Bezig…" : `Verstuur${selected.size > 0 ? ` (${selected.size})` : ""}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
