"use client";

import { useEffect, useState } from "react";

/**
 * Inline bewerkbare routenaam (Routes-tab).
 * Opslaan gebeurt bij blur / Enter.
 */
export default function EditableRouteName({
  routeNummer,
  value,
  className,
  onSave,
}: {
  routeNummer: number;
  value: string;
  className?: string;
  onSave: (naam: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = async () => {
    const next = String(draft ?? "").trim() || `Route ${routeNummer}`;
    setDraft(next);
    if (next === value) return;
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      type="text"
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        void commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label={`Naam route ${routeNummer}`}
      title="Klik om routenaam te wijzigen"
      className={`min-w-[6rem] max-w-[16rem] rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold hover:border-current/25 focus:border-current focus:bg-white focus:outline-none focus:ring-1 focus:ring-koopje-orange/40 disabled:opacity-60 ${className ?? ""}`}
    />
  );
}
