"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  orderId: string;
  link: string | null | undefined;
  email: string | null | undefined;
  onUpdated?: (next: { link: string }) => void;
};

export default function FactuurCell({ orderId, link, email, onUpdated }: Props) {
  const href = String(link ?? "").trim();
  const currentEmail = String(email ?? "").trim();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [draftEmail, setDraftEmail] = useState(currentEmail);

  async function openSend() {
    setDraftEmail(currentEmail);
    setOpen(true);

    if (href) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/factuur?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Factuur laden mislukt");
      const nextLink = String(data?.link_factuur ?? "").trim();
      if (nextLink) onUpdated?.({ link: nextLink });
      if (data?.email) setDraftEmail(String(data.email));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Factuur laden mislukt");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    const cleaned = draftEmail.trim();
    if (!cleaned || !cleaned.includes("@")) {
      window.alert("E-mailadres is verplicht.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/factuur`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Verzenden mislukt");
      const nextLink = String(data?.link_factuur ?? href).trim();
      if (nextLink) onUpdated?.({ link: nextLink });
      window.alert("Factuur verzonden via Moneybird.");
      setOpen(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Verzenden mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
      {href ? (
        <>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-koopje-orange underline underline-offset-2 hover:text-koopje-orange/80"
          >
            Download PDF
          </a>
          <button
            type="button"
            onClick={openSend}
            disabled={busy}
            className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            {busy ? "Bezig…" : "Verzenden"}
          </button>
        </>
      ) : (
        <>
          <span className="text-stone-300">—</span>
          <button
            type="button"
            onClick={openSend}
            disabled={busy}
            className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            title="Zoek factuur in Moneybird en verzend"
          >
            {busy ? "Bezig…" : "Opzoeken / verzenden"}
          </button>
        </>
      )}

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[env(safe-area-inset-top,1rem)]">
            <div className="my-auto w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-koopje-black">Factuur verzenden</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
                >
                  Sluiten
                </button>
              </div>

              <p className="mb-3 text-sm text-stone-600">
                De factuur wordt via Moneybird per e-mail verstuurd. Velden op de factuur zelf zijn
                niet bewerkbaar.
              </p>

              {href ? (
                <div className="mb-4 rounded border border-stone-200">
                  <iframe src={href} title="Factuur PDF" className="h-[220px] w-full sm:h-[360px]" />
                </div>
              ) : null}

              <label className="mb-1 block text-xs font-medium text-stone-600">E-mailadres</label>
              <input
                value={draftEmail}
                onChange={(e) => setDraftEmail(e.target.value)}
                className="mb-4 w-full rounded border border-stone-300 px-3 py-2 text-sm"
                placeholder="klant@email.nl"
                type="email"
              />

              <div className="flex justify-end gap-2">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                  >
                    Download PDF
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy}
                  className="rounded bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
                >
                  {busy ? "Verzenden…" : "Verzend factuur"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
