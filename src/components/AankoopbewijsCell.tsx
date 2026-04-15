"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  orderId: string;
  link: string | null | undefined;
  email: string | null | undefined;
  onUpdated?: (next: { link: string; email: string }) => void;
};

export default function AankoopbewijsCell({ orderId, link, email, onUpdated }: Props) {
  const href = String(link ?? "").trim();
  const currentEmail = String(email ?? "").trim();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [draftEmail, setDraftEmail] = useState(currentEmail);
  const [pdfNaam, setPdfNaam] = useState("");
  const [pdfDatum, setPdfDatum] = useState("");
  const [pdfFiets, setPdfFiets] = useState("");
  const [pdfPrijs, setPdfPrijs] = useState("");
  const [pdfSerienummer, setPdfSerienummer] = useState("");

  async function openEditor() {
    if (!href) return;
    setOpen(true);
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/aankoopbewijs?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Aankoopbewijs laden mislukt");
      setDraftEmail(String(data?.email ?? currentEmail));
      setPdfNaam(String(data?.pdf?.naam ?? ""));
      setPdfDatum(String(data?.pdf?.datum ?? ""));
      setPdfFiets(String(data?.pdf?.fiets ?? ""));
      setPdfPrijs(String(data?.pdf?.prijs ?? ""));
      setPdfSerienummer(String(data?.pdf?.serienummer ?? ""));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Aankoopbewijs laden mislukt");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    const cleaned = draftEmail.trim();
    if (!cleaned) {
      window.alert("E-mailadres is verplicht.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/aankoopbewijs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleaned,
          pdf: {
            naam: pdfNaam,
            datum: pdfDatum,
            fiets: pdfFiets,
            prijs: pdfPrijs,
            serienummer: pdfSerienummer,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Opnieuw verzenden mislukt");
      onUpdated?.({
        link: String(data.link_aankoopbewijs ?? href),
        email: String(data.email ?? cleaned),
      });
      window.alert("Aankoopbewijs opnieuw verzonden.");
      setOpen(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Opnieuw verzenden mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {href ? (
        <>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-koopje-orange underline underline-offset-2 hover:text-koopje-orange/80"
          >
            Bekijk PDF
          </a>
          <button
            type="button"
            onClick={openEditor}
            disabled={busy}
            className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            {busy ? "Laden…" : "Bewerk / opnieuw verzenden"}
          </button>
        </>
      ) : (
        <span className="text-stone-300">—</span>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[env(safe-area-inset-top,1rem)]">
          <div className="my-auto w-full max-w-4xl rounded-xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-koopje-black">Aankoopbewijs bewerken en verzenden</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
              >
                Sluiten
              </button>
            </div>

            <div className="mb-4 rounded border border-stone-200">
              <iframe
                src={href}
                title="Aankoopbewijs PDF"
                className="h-[200px] w-full sm:h-[420px]"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input value={draftEmail} onChange={(e) => setDraftEmail(e.target.value)} className="rounded border border-stone-300 px-3 py-2 text-sm" placeholder="Email" />
              <input value={pdfNaam} onChange={(e) => setPdfNaam(e.target.value)} className="rounded border border-stone-300 px-3 py-2 text-sm" placeholder="Naam op PDF" />
              <input value={pdfDatum} onChange={(e) => setPdfDatum(e.target.value)} className="rounded border border-stone-300 px-3 py-2 text-sm" placeholder="Datum op PDF" />
              <input value={pdfFiets} onChange={(e) => setPdfFiets(e.target.value)} className="rounded border border-stone-300 px-3 py-2 text-sm" placeholder="Fiets op PDF" />
              <input value={pdfPrijs} onChange={(e) => setPdfPrijs(e.target.value)} className="rounded border border-stone-300 px-3 py-2 text-sm" placeholder="Prijs op PDF" />
              <input value={pdfSerienummer} onChange={(e) => setPdfSerienummer(e.target.value)} className="rounded border border-stone-300 px-3 py-2 text-sm" placeholder="Serienummer op PDF" />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleResend}
                disabled={busy}
                className="rounded bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
              >
                {busy ? "Verzenden…" : "Verzend aankoopbewijs"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

