"use client";

import { useCallback, useEffect, useState } from "react";
import type { IncomingDeliveryRow } from "@/app/api/inventory/incoming-deliveries/route";

type Props = {
  open: boolean;
  onClose: () => void;
};

function formatNl(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function trackHref(url: string): string {
  const s = url.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export default function IncomingDeliveriesModal({ open, onClose }: Props) {
  const [pending, setPending] = useState<IncomingDeliveryRow[]>([]);
  const [received, setReceived] = useState<IncomingDeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [trackUrl, setTrackUrl] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/incoming-deliveries?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden mislukt");
      setPending(Array.isArray(data.pending) ? data.pending : []);
      setReceived(Array.isArray(data.received) ? data.received : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTrackUrl("");
    setNote("");
    setMessage(null);
    setError(null);
    load();
  }, [open, load]);

  const saveNew = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/inventory/incoming-deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_trace_url: trackUrl, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Opslaan mislukt");
      setTrackUrl("");
      setNote("");
      setMessage("Track & trace opgeslagen.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const markReceived = async (id: string) => {
    setReceivingId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/inventory/incoming-deliveries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "receive" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Markeren mislukt");
      setMessage("Levering gemarkeerd als ontvangen.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Markeren mislukt");
    } finally {
      setReceivingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-labelledby="incoming-deliveries-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
          <div>
            <h2
              id="incoming-deliveries-title"
              className="text-base font-semibold text-koopje-black sm:text-lg"
            >
              Inkomende leveringen
            </h2>
            <p className="text-xs text-stone-500 sm:text-sm">
              Track &amp; trace van bestellingen die nog onderweg zijn (bijv. voor een
              klantorder).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          <section className="rounded-xl border border-stone-200 bg-stone-50/80 p-4">
            <h3 className="text-sm font-semibold text-koopje-black">Nieuwe track &amp; trace</h3>
            <label className="mt-3 block text-xs font-medium text-stone-600">
              Track &amp; trace-link
            </label>
            <input
              type="url"
              value={trackUrl}
              onChange={(e) => setTrackUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange/40"
            />
            <label className="mt-3 block text-xs font-medium text-stone-600">
              Opmerking (optioneel)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Bijv. ordernummer of klantnaam"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange/40"
            />
            <button
              type="button"
              onClick={saveNew}
              disabled={saving || !trackUrl.trim()}
              className="mt-3 rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
            >
              {saving ? "Opslaan…" : "Opslaan"}
            </button>
          </section>

          {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <section className="mt-6">
            <h3 className="text-sm font-semibold text-koopje-black">
              Onderweg ({pending.length})
            </h3>
            {loading ? (
              <p className="mt-2 text-sm text-stone-500">Laden…</p>
            ) : pending.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Geen openstaande leveringen.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pending.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={trackHref(row.track_trace_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-sm font-medium text-koopje-orange hover:underline"
                      >
                        {row.track_trace_url}
                      </a>
                      {row.note && (
                        <p className="mt-1 text-sm text-stone-600">{row.note}</p>
                      )}
                      <p className="mt-1 text-xs text-stone-400">
                        Toegevoegd {formatNl(row.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => markReceived(row.id)}
                      disabled={receivingId === row.id}
                      className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {receivingId === row.id ? "Bezig…" : "Levering ontvangen"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {received.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-koopje-black">
                Ontvangen ({received.length})
              </h3>
              <ul className="mt-3 space-y-2">
                {received.slice(0, 30).map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-stone-100 bg-stone-50/80 p-3"
                  >
                    <a
                      href={trackHref(row.track_trace_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm text-stone-700 hover:underline"
                    >
                      {row.track_trace_url}
                    </a>
                    {row.note && (
                      <p className="mt-1 text-sm text-stone-500">{row.note}</p>
                    )}
                    <p className="mt-1 text-xs text-stone-400">
                      Ontvangen {formatNl(row.received_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
