"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onSave?: (value: string) => void | Promise<void>;
  /** Alleen voor reparatie: apart veld, niet zichtbaar in de cel-preview. */
  achtergrondverhaal?: string | null;
  onSaveAchtergrondverhaal?: (value: string) => void | Promise<void>;
}

function isKlikbaarOpmerking(value: string): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && normalized !== "geen opmerking";
}

export default function OpmerkingKlantCell({
  value,
  onSave,
  achtergrondverhaal,
  onSaveAchtergrondverhaal,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftAchtergrond, setDraftAchtergrond] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const text = String(value ?? "").trim();
  const achtergrond = String(achtergrondverhaal ?? "").trim();
  const showAchtergrond = typeof onSaveAchtergrondverhaal === "function";
  const klikbaarOpmerking = isKlikbaarOpmerking(text);
  const canEdit = Boolean(onSave) || showAchtergrond;
  const canOpen = klikbaarOpmerking || showAchtergrond || canEdit;

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  function openPopup(startEditing = false) {
    setDraft(text);
    setDraftAchtergrond(achtergrond);
    setEditing(startEditing || !klikbaarOpmerking);
    setOpen(true);
  }

  async function handleSave() {
    if (!onSave && !onSaveAchtergrondverhaal) return;
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];
      if (onSave) tasks.push(Promise.resolve(onSave(draft)));
      if (onSaveAchtergrondverhaal) {
        tasks.push(Promise.resolve(onSaveAchtergrondverhaal(draftAchtergrond)));
      }
      await Promise.all(tasks);
      setEditing(false);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!canOpen) {
    return (
      <span className="block px-2 py-1.5 text-sm text-stone-700">
        {text || "—"}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      {klikbaarOpmerking ? (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPopup(false))}
          className="w-full px-2 py-1.5 text-left text-sm text-stone-700 hover:bg-koopje-orange-light/40"
        >
          <span className="line-clamp-2 leading-snug">{text}</span>
          <span className="ml-1 inline-block align-middle text-[10px] text-koopje-orange opacity-70">
            ▾
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => openPopup(true)}
          className="w-full px-2 py-1.5 text-left text-sm text-koopje-orange hover:bg-koopje-orange-light/40"
        >
          Opmerking toevoegen
        </button>
      )}

      {open && (
        <div
          className={`absolute left-0 top-full z-50 mt-1 rounded-xl border border-stone-200 bg-white p-4 shadow-2xl ${
            showAchtergrond ? "w-[28rem] max-w-[90vw]" : "w-96"
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              {showAchtergrond ? "Opmerkingen" : "Opmerkingen klant"}
            </p>
            {canEdit && !editing && (
              <button
                type="button"
                onClick={() => {
                  setDraft(text);
                  setDraftAchtergrond(achtergrond);
                  setEditing(true);
                }}
                className="rounded px-2 py-1 text-xs text-koopje-orange hover:bg-koopje-orange-light/50"
              >
                Bewerken
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                  Opmerkingen klant
                </p>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-28 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-700 outline-none focus:border-koopje-orange focus:ring-2 focus:ring-koopje-orange/20"
                  placeholder="Typ opmerking..."
                />
              </div>
              {showAchtergrond && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    Achtergrondverhaal
                  </p>
                  <textarea
                    value={draftAchtergrond}
                    onChange={(e) => setDraftAchtergrond(e.target.value)}
                    className="h-40 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-700 outline-none focus:border-koopje-orange focus:ring-2 focus:ring-koopje-orange/20"
                    placeholder="Achtergrondverhaal bij deze reparatie..."
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(text);
                    setDraftAchtergrond(achtergrond);
                    if (!klikbaarOpmerking && !achtergrond) setOpen(false);
                  }}
                  disabled={saving}
                  className="flex-1 rounded-lg border border-stone-200 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-koopje-orange py-1.5 text-xs font-medium text-white hover:bg-koopje-orange/90 disabled:opacity-50"
                >
                  {saving ? "Opslaan..." : "Opslaan"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                  Opmerkingen klant
                </p>
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  {text || "—"}
                </div>
              </div>
              {showAchtergrond && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    Achtergrondverhaal
                  </p>
                  <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    {achtergrond || "—"}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
