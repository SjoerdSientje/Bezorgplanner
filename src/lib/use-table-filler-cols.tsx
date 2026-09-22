"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Breedte per lege vulkolom (zelfde als EditableSheetTable / planning). */
export const TABLE_FILLER_CELL_PX = 64;

/**
 * Voegt lege kolommen toe als de tabel smaller is dan de wrapper, zodat
 * content-kolommen hun natuurlijke breedte houden i.p.v. uit te rekken (w-full).
 */
export function useTableFillerCols(
  wrapperRef: RefObject<HTMLElement | null>,
  tableRef: RefObject<HTMLTableElement | null>,
  deps: readonly unknown[] = []
): number {
  const [fillerCols, setFillerCols] = useState(0);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const table = tableRef.current;
    if (!wrapper || !table) return;

    const recompute = () => {
      const wrapperWidth = wrapper.clientWidth;
      const tableWidth = table.getBoundingClientRect().width;
      const contentWidth = Math.max(0, tableWidth - fillerCols * TABLE_FILLER_CELL_PX);
      const need = Math.max(0, Math.floor((wrapperWidth - contentWidth) / TABLE_FILLER_CELL_PX));
      if (need !== fillerCols) setFillerCols(need);
    };

    recompute();
    const ro = new ResizeObserver(() => recompute());
    ro.observe(wrapper);
    ro.observe(table);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillerCols, wrapperRef, tableRef, ...deps]);

  return fillerCols;
}

export function TableFillerHeaderCells({
  count,
  borderClass = "border-stone-200",
  bgClass = "bg-stone-100",
}: {
  count: number;
  borderClass?: string;
  bgClass?: string;
}) {
  if (count <= 0) return null;
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <th
          key={`__fill_h_${idx}`}
          className={`w-16 min-w-[4rem] whitespace-nowrap border ${borderClass} ${bgClass} px-2 py-2`}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

export function TableFillerBodyCells({
  count,
  borderClass = "border-stone-200",
}: {
  count: number;
  borderClass?: string;
}) {
  if (count <= 0) return null;
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <td
          key={`__fill_${idx}`}
          className={`w-16 min-w-[4rem] border ${borderClass} p-0 align-top`}
          aria-hidden="true"
        />
      ))}
    </>
  );
}
