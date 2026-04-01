"use client";

import { useState } from "react";

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

  async function handleResend() {
    const nextEmail = window.prompt(
      "Naar welk e-mailadres wil je het aankoopbewijs (opnieuw) sturen?",
      currentEmail
    );
    if (nextEmail == null) return;
    const cleaned = nextEmail.trim();
    if (!cleaned) {
      window.alert("E-mailadres is verplicht.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/aankoopbewijs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Opnieuw verzenden mislukt");
      onUpdated?.({
        link: String(data.link_aankoopbewijs ?? href),
        email: String(data.email ?? cleaned),
      });
      window.alert("Aankoopbewijs opnieuw verzonden.");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Opnieuw verzenden mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-koopje-orange underline underline-offset-2 hover:text-koopje-orange/80"
        >
          Bekijk PDF
        </a>
      ) : (
        <span className="text-stone-300">—</span>
      )}
      <button
        type="button"
        onClick={handleResend}
        disabled={busy}
        className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
      >
        {busy ? "Verzenden…" : "Bewerk / opnieuw verzenden"}
      </button>
    </div>
  );
}

