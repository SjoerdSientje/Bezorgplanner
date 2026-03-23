"use client";

interface JaNeeCellProps {
  value: string;
  onSave: (v: string) => void;
  /** Geef false voor lege (niet-data) rijen: toont dan niets. */
  isDataRow: boolean;
}

/**
 * Inline Ja/Nee toggle voor boolean-kolommen in tabellen.
 * Klikt direct op; geen blur nodig.
 */
export default function JaNeeCell({ value, onSave, isDataRow }: JaNeeCellProps) {
  if (!isDataRow) return null;

  const lower = value.trim().toLowerCase();
  const isJa = lower === "ja";
  const isNee = lower === "nee";

  return (
    <div className="flex gap-1 px-1.5 py-1.5">
      <button
        type="button"
        onClick={() => { if (!isJa) onSave("ja"); }}
        className={`rounded-lg px-2.5 py-0.5 text-xs font-semibold transition ${
          isJa
            ? "bg-green-100 text-green-700 ring-1 ring-inset ring-green-300"
            : "bg-stone-100 text-stone-400 hover:bg-green-50 hover:text-green-600"
        }`}
      >
        Ja
      </button>
      <button
        type="button"
        onClick={() => { if (!isNee) onSave("nee"); }}
        className={`rounded-lg px-2.5 py-0.5 text-xs font-semibold transition ${
          isNee
            ? "bg-red-100 text-red-700 ring-1 ring-inset ring-red-300"
            : "bg-stone-100 text-stone-400 hover:bg-red-50 hover:text-red-600"
        }`}
      >
        Nee
      </button>
    </div>
  );
}
