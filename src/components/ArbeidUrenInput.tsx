"use client";

import { useEffect, useState } from "react";
import {
  ARBEID_UUR_PRIJS_INCL,
  arbeidPrijsIncl,
  arbeidUrenFromPrijsIncl,
} from "@/lib/reparaties";

type Props = {
  /** Arbeidsuren als string (vrij typen, komma toegestaan). */
  uren: string;
  onUrenChange: (uren: string) => void;
  /** Compactere labels (bijv. in dichte form-grids). */
  compact?: boolean;
  className?: string;
};

function parseNum(raw: string): number {
  return parseFloat(String(raw).replace(",", ".")) || 0;
}

function formatUren(n: number): string {
  if (n <= 0) return "";
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

/**
 * Koppeling uren ↔ arbeidskosten (€ incl. 9%).
 * Vul de ene in; de andere wordt automatisch berekend.
 */
export default function ArbeidUrenInput({
  uren,
  onUrenChange,
  compact = false,
  className = "",
}: Props) {
  const urenNum = parseNum(uren);
  const [editing, setEditing] = useState<"uren" | "kosten" | null>(null);
  const [kostenDraft, setKostenDraft] = useState("");

  const berekendeKosten =
    urenNum > 0 ? arbeidPrijsIncl(urenNum).toFixed(2) : "";

  useEffect(() => {
    if (editing !== "kosten") {
      setKostenDraft(berekendeKosten);
    }
  }, [berekendeKosten, editing]);

  const labelCls = compact
    ? "text-xs text-koopje-black/50"
    : "text-xs text-koopje-black/50";
  const inputCls =
    "mt-0.5 w-full rounded border border-koopje-black/20 px-2 py-1.5 text-sm";

  return (
    <div className={`grid gap-2 sm:grid-cols-2 ${className}`.trim()}>
      <label className={labelCls}>
        Arbeidsuren
        <input
          type="text"
          inputMode="decimal"
          className={inputCls}
          value={uren}
          placeholder="bijv. 1 of 1,5"
          onFocus={() => setEditing("uren")}
          onBlur={() => setEditing(null)}
          onChange={(e) => {
            setEditing("uren");
            onUrenChange(e.target.value);
          }}
        />
      </label>
      <label className={labelCls}>
        Arbeidskosten € (incl. 9%)
        <input
          type="text"
          inputMode="decimal"
          className={inputCls}
          value={editing === "kosten" ? kostenDraft : berekendeKosten}
          placeholder={`bijv. ${ARBEID_UUR_PRIJS_INCL.toFixed(2)}`}
          onFocus={() => {
            setEditing("kosten");
            setKostenDraft(berekendeKosten);
          }}
          onBlur={() => setEditing(null)}
          onChange={(e) => {
            setEditing("kosten");
            const raw = e.target.value;
            setKostenDraft(raw);
            const kosten = parseNum(raw);
            onUrenChange(kosten > 0 ? formatUren(arbeidUrenFromPrijsIncl(kosten)) : "");
          }}
        />
      </label>
      <p className="sm:col-span-2 text-[11px] text-koopje-black/40">
        €{ARBEID_UUR_PRIJS_INCL.toFixed(2)} / uur incl. 9% — vul uren of bedrag in, de ander volgt.
      </p>
    </div>
  );
}
