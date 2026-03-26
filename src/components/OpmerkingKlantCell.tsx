"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
}

function isKlikbaarOpmerking(value: string): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && normalized !== "geen opmerking";
}

export default function OpmerkingKlantCell({ value }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const text = String(value ?? "").trim();
  const klikbaar = isKlikbaarOpmerking(text);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  if (!klikbaar) {
    return (
      <span className="block px-2 py-1.5 text-sm text-stone-700">
        {text || "—"}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2 py-1.5 text-left text-sm text-stone-700 hover:bg-koopje-orange-light/40"
      >
        <span className="line-clamp-2 leading-snug">{text}</span>
        <span className="ml-1 inline-block align-middle text-[10px] text-koopje-orange opacity-70">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-96 rounded-xl border border-stone-200 bg-white p-3 shadow-2xl">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
            Opmerkingen klant
          </p>
          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
            {text}
          </div>
        </div>
      )}
    </div>
  );
}
