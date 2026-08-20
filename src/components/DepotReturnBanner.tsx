"use client";

import { DEPOT_RELOAD_MINUTES } from "@/lib/routific-payload";

export const DEPOT_ADDRESS_SHORT = "Kapelweg 2, De Bilt";

/** Amber “Terug naar depot”-balk (Routes / Planning / Lijst Sjoerd). */
export default function DepotReturnBanner({
  partAfter,
  className,
}: {
  /** Deelnummer na deze retour (2, 3, …). */
  partAfter: number;
  className?: string;
}) {
  return (
    <div className={`border-b border-amber-200 bg-amber-50 ${className ?? ""}`}>
      <div className="sticky left-0 z-[1] w-max max-w-[min(100vw,48rem)] px-3 py-2.5 text-sm text-amber-950">
        <span className="font-semibold">Terug naar depot</span>
        <span className="text-amber-800">
          {" "}
          · {DEPOT_ADDRESS_SHORT} · herladen {DEPOT_RELOAD_MINUTES} min · daarna deel {partAfter}
        </span>
      </div>
    </div>
  );
}

/** Volledige tabelrij voor Planning (colSpan over alle kolommen). */
export function DepotReturnTableRow({
  partAfter,
  colSpan,
}: {
  partAfter: number;
  colSpan: number;
}) {
  return (
    <tr className="bg-amber-50">
      <td
        colSpan={colSpan}
        className="border border-amber-200 px-3 py-2.5 text-sm text-amber-950"
      >
        <span className="font-semibold">Terug naar depot</span>
        <span className="text-amber-800">
          {" "}
          · {DEPOT_ADDRESS_SHORT} · herladen {DEPOT_RELOAD_MINUTES} min · daarna deel {partAfter}
        </span>
      </td>
    </tr>
  );
}
