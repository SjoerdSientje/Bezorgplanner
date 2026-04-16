"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Section = "nieuwe_order" | "nieuw_tijdslot";

type AppjesOrder = {
  order_id: string;
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

function OrderCard({
  order,
  selected,
  onToggle,
}: {
  order: AppjesOrder;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
        selected
          ? "border-koopje-orange bg-koopje-orange-light/40"
          : "border-koopje-black/10 hover:border-koopje-orange/40 hover:bg-koopje-black/5"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 rounded accent-koopje-orange"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-koopje-black">{order.naam || "Onbekend"}</span>
          <span className="rounded bg-koopje-black/10 px-1.5 py-0.5 text-xs text-koopje-black/60">
            {order.order_nummer}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-koopje-black/60">
          <span>
            <span className="font-medium text-koopje-black/80">Tijdslot:</span>{" "}
            {order.aankomsttijd_slot || <em>geen</em>}
          </span>
          {order.telefoon_e164 && (
            <span>
              <span className="font-medium text-koopje-black/80">Tel:</span> {order.telefoon_e164}
            </span>
          )}
          {!order.telefoon_e164 && order.telefoon_nummer && (
            <span className="text-amber-600">Geen E.164 nummer</span>
          )}
          {!order.telefoon_e164 && !order.telefoon_nummer && (
            <span className="text-red-500">Geen telefoonnummer</span>
          )}
        </div>
      </div>
    </label>
  );
}

function SectionBlock({
  title,
  description,
  orders,
  selected,
  onToggle,
  onToggleAll,
  emptyText,
}: {
  title: string;
  description: string;
  orders: AppjesOrder[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  emptyText: string;
}) {
  const allSelected = orders.length > 0 && selected.size === orders.length;
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-koopje-black">{title}</h3>
        <p className="text-xs text-koopje-black/60">{description}</p>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm italic text-koopje-black/40">{emptyText}</p>
      ) : (
        <div className="space-y-2 rounded-xl border border-koopje-black/10 p-3">
          <label className="mb-1 flex cursor-pointer items-center gap-2 text-xs font-medium text-koopje-black/60 hover:text-koopje-black">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              className="h-3.5 w-3.5 rounded accent-koopje-orange"
            />
            Alles selecteren
          </label>
          {orders.map((o) => (
            <OrderCard
              key={o.order_id}
              order={o}
              selected={selected.has(o.order_id)}
              onToggle={() => onToggle(o.order_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StuurAppjesButton({ huidigeRitjesOrders, onBeforeOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [nieuweOrderOrders, setNieuweOrderOrders] = useState<AppjesOrder[]>([]);
  const [nieuwTijdslotOrders, setNieuwTijdslotOrders] = useState<AppjesOrder[]>([]);
  const [selectedNieuweOrder, setSelectedNieuweOrder] = useState<Set<string>>(new Set());
  const [selectedNieuwTijdslot, setSelectedNieuwTijdslot] = useState<Set<string>>(new Set());
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

  function rawToOrder(o: Record<string, unknown>): AppjesOrder {
    return {
      order_id: String(o.id ?? ""),
      order_nummer: String(o.order_nummer ?? ""),
      naam: String(o.naam ?? ""),
      aankomsttijd_slot: String(o.aankomsttijd_slot ?? ""),
      telefoon_e164: String(o.telefoon_e164 ?? ""),
      telefoon_nummer: String(o.telefoon_nummer ?? ""),
      bezorgtijd_voorkeur: String(o.bezorgtijd_voorkeur ?? ""),
    };
  }

  function mergeWithCurrent(order: AppjesOrder): AppjesOrder {
    const cur = currentByOrderId.get(order.order_id);
    if (!cur) return order;
    return {
      ...order,
      aankomsttijd_slot:
        cur.aankomsttijd_slot != null && String(cur.aankomsttijd_slot).trim() !== ""
          ? String(cur.aankomsttijd_slot)
          : order.aankomsttijd_slot,
      order_nummer: cur.order_nummer != null ? String(cur.order_nummer) : order.order_nummer,
      naam: cur.naam != null ? String(cur.naam) : order.naam,
      telefoon_e164: cur.telefoon_e164 != null ? String(cur.telefoon_e164) : order.telefoon_e164,
      telefoon_nummer:
        cur.telefoon_nummer != null ? String(cur.telefoon_nummer) : order.telefoon_nummer,
      bezorgtijd_voorkeur:
        cur.bezorgtijd_voorkeur != null
          ? String(cur.bezorgtijd_voorkeur)
          : order.bezorgtijd_voorkeur,
    };
  }

  async function fetchAndSplit() {
    // Fetch ritjes-vandaag
    const ritjesRes = await fetch(`/api/ritjes-vandaag?t=${Date.now()}`, { cache: "no-store" });
    const ritjesJson = await ritjesRes.json().catch(() => ({}));
    if (!ritjesRes.ok) throw new Error(String(ritjesJson.error ?? "Orders ophalen mislukt."));

    const allOrders: AppjesOrder[] = (ritjesJson.orders ?? [])
      .filter((o: Record<string, unknown>) => String(o?.aankomsttijd_slot ?? "").trim() !== "")
      .map((o: Record<string, unknown>) => mergeWithCurrent(rawToOrder(o)));

    // Fetch planning to know which orders are already in planning / ritjes voor morgen
    const planningRes = await fetch(`/api/planning?t=${Date.now()}`, { cache: "no-store" });
    const planningJson = await planningRes.json().catch(() => ({}));
    const planningOrderIds = new Set<string>(
      (planningJson.rows ?? []).map((r: Record<string, unknown>) => String(r.order_id ?? ""))
    );

    const nieuw: AppjesOrder[] = [];
    const bestaand: AppjesOrder[] = [];
    for (const o of allOrders) {
      if (planningOrderIds.has(o.order_id)) {
        bestaand.push(o);
      } else {
        nieuw.push(o);
      }
    }
    return { nieuw, bestaand };
  }

  const openDialog = useCallback(async () => {
    setResult(null);
    setSelectedNieuweOrder(new Set());
    setSelectedNieuwTijdslot(new Set());
    setLoadingOrders(true);
    setOpen(true);
    try {
      if (onBeforeOpen) await onBeforeOpen();
      await new Promise((r) => setTimeout(r, 250));

      const { nieuw, bestaand } = await fetchAndSplit();
      setNieuweOrderOrders(nieuw);
      setNieuwTijdslotOrders(bestaand);

      // Retry voor eventuele in-flight PATCHes
      await new Promise((r) => setTimeout(r, 500));
      const { nieuw: nieuw2, bestaand: bestaand2 } = await fetchAndSplit();
      setNieuweOrderOrders(nieuw2);
      setNieuwTijdslotOrders(bestaand2);
    } catch (e) {
      setNieuweOrderOrders([]);
      setNieuwTijdslotOrders([]);
      setResult({ ok: false, error: e instanceof Error ? e.message : "Orders ophalen mislukt." });
    } finally {
      setLoadingOrders(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBeforeOpen, currentByOrderId]);

  function toggleOrder(orderId: string, section: Section) {
    if (section === "nieuwe_order") {
      setSelectedNieuweOrder((prev) => {
        const next = new Set(prev);
        if (next.has(orderId)) next.delete(orderId);
        else next.add(orderId);
        return next;
      });
    } else {
      setSelectedNieuwTijdslot((prev) => {
        const next = new Set(prev);
        if (next.has(orderId)) next.delete(orderId);
        else next.add(orderId);
        return next;
      });
    }
  }

  function toggleAll(section: Section) {
    if (section === "nieuwe_order") {
      setSelectedNieuweOrder((prev) =>
        prev.size === nieuweOrderOrders.length
          ? new Set()
          : new Set(nieuweOrderOrders.map((o) => o.order_id))
      );
    } else {
      setSelectedNieuwTijdslot((prev) =>
        prev.size === nieuwTijdslotOrders.length
          ? new Set()
          : new Set(nieuwTijdslotOrders.map((o) => o.order_id))
      );
    }
  }

  const totalSelected = selectedNieuweOrder.size + selectedNieuwTijdslot.size;

  async function handleVerstuur() {
    if (totalSelected === 0) return;
    setSending(true);
    setResult(null);
    try {
      // Herlaad voor verzending om altijd het nieuwste tijdslot te sturen
      const latestRes = await fetch(`/api/ritjes-vandaag?t=${Date.now()}`, { cache: "no-store" });
      const latestData = await latestRes.json().catch(() => ({}));
      const latestById = new Map<string, Record<string, unknown>>();
      for (const o of (latestData.orders ?? []) as Record<string, unknown>[]) {
        const id = String(o.id ?? "");
        if (id) latestById.set(id, o);
      }

      type Payload = AppjesOrder & { section: Section };
      const payload: Payload[] = [];

      for (const o of nieuweOrderOrders) {
        if (!selectedNieuweOrder.has(o.order_id)) continue;
        const latest = latestById.get(o.order_id);
        const merged = latest ? mergeWithCurrent(rawToOrder(latest)) : o;
        payload.push({ ...merged, section: "nieuwe_order" });
      }
      for (const o of nieuwTijdslotOrders) {
        if (!selectedNieuwTijdslot.has(o.order_id)) continue;
        const latest = latestById.get(o.order_id);
        const merged = latest ? mergeWithCurrent(rawToOrder(latest)) : o;
        payload.push({ ...merged, section: "nieuw_tijdslot" });
      }

      const res = await fetch("/api/stuur-appjes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? "Versturen mislukt." });
      } else {
        const details = Array.isArray(data.details) ? data.details : [];
        const failedDetails = details.filter(
          (d: string) =>
            String(d).toLowerCase().includes("mislukt") ||
            String(d).toLowerCase().includes("fout")
        );
        setResult({
          ok: failedDetails.length === 0,
          message:
            failedDetails.length === 0
              ? (data.message ?? "Appjes verstuurd.")
              : `${data.message ?? "Deels verzonden."} ${failedDetails.slice(0, 2).join(" | ")}`,
          error:
            failedDetails.length > 0
              ? `${data.message ?? "Deels verzonden."} ${failedDetails.slice(0, 2).join(" | ")}`
              : undefined,
        });
        setSelectedNieuweOrder(new Set());
        setSelectedNieuwTijdslot(new Set());
      }
    } catch {
      setResult({ ok: false, error: "Er ging iets mis. Probeer het opnieuw." });
    } finally {
      setSending(false);
    }
  }

  const modal = open ? (
    <>
      <div
        className="fixed inset-0 z-40 bg-koopje-black/40"
        aria-hidden
        onClick={() => setOpen(false)}
      />
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8">
        <div className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-koopje-black/10 px-5 py-4">
            <div>
              <h2 className="font-semibold text-koopje-black">Stuur appjes</h2>
              <p className="text-xs text-koopje-black/60">
                Selecteer orders per sectie
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-koopje-black/50 hover:bg-koopje-black/5 hover:text-koopje-black"
              aria-label="Sluiten"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-6">
            {loadingOrders ? (
              <p className="text-sm text-koopje-black/60">Laden…</p>
            ) : (
              <>
                <SectionBlock
                  title="Nieuwe order"
                  description="Orders met tijdslot die nog niet in de planning staan. Worden na versturen ook aan de planning toegevoegd."
                  orders={nieuweOrderOrders}
                  selected={selectedNieuweOrder}
                  onToggle={(id) => toggleOrder(id, "nieuwe_order")}
                  onToggleAll={() => toggleAll("nieuwe_order")}
                  emptyText="Geen nieuwe orders met tijdslot."
                />

                <div className="border-t border-koopje-black/10" />

                <SectionBlock
                  title="Nieuw tijdslot"
                  description="Orders die al in de planning staan met een gewijzigd tijdslot."
                  orders={nieuwTijdslotOrders}
                  selected={selectedNieuwTijdslot}
                  onToggle={(id) => toggleOrder(id, "nieuw_tijdslot")}
                  onToggleAll={() => toggleAll("nieuw_tijdslot")}
                  emptyText="Geen orders in planning met gewijzigd tijdslot."
                />
              </>
            )}

            {result && (
              <p
                className={`rounded-lg px-4 py-3 text-sm ${
                  result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
                }`}
              >
                {result.ok ? result.message : result.error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-koopje-black/10 px-5 py-3">
            <span className="text-xs text-koopje-black/50">{totalSelected} geselecteerd</span>
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
                disabled={totalSelected === 0 || sending}
                className="rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
              >
                {sending ? "Bezig…" : `Verstuur${totalSelected > 0 ? ` (${totalSelected})` : ""}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-2 rounded-lg border border-koopje-black/20 bg-white px-4 py-2 text-sm font-medium text-koopje-black transition hover:border-koopje-orange hover:text-koopje-orange focus:outline-none focus:ring-2 focus:ring-koopje-orange"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        Stuur appjes
      </button>
      {typeof document !== "undefined" && modal
        ? createPortal(modal, document.body)
        : null}
    </>
  );
}
