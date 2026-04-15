"use client";

import React, { useState, useCallback, useEffect, useRef, useLayoutEffect } from "react";

const MIN_ROWS = 50;

interface EditableSheetTableProps {
  headers: readonly string[];
  initialData?: string[][];
  onCellBlur?: (rowIndex: number, header: string, value: string) => void;
  /** Aantal echte datarijen (wordt gebruikt om actie-iconen zichtbaar te maken). */
  dataRowCount?: number;
  /** Optionele actie per data-rij (bijv. prullenbak). */
  rowAction?: (rowIndex: number) => void;
  cellRenderers?: Record<string, (rowIndex: number, value: string, onSave: (v: string) => void) => React.ReactNode>;
  /** Zet de tabel volledig read-only (geen inputs/bewerkingen, geen custom renderers). */
  readOnly?: boolean;
  /** Toon rijnummers links (sticky) en maak cellen keyboard-navigable. */
  showRowNumbers?: boolean;
  /** Optionele achtergrondkleur per data-rij (Tailwind-klasse, bijv. "bg-green-50"). */
  rowColorClass?: (rowIndex: number) => string | undefined;
  /**
   * Verhoog deze waarde wanneer je de tabel geforceerd wilt resetten vanuit initialData
   * (bijv. na een echte server-fetch). Celwijzigingen mogen deze NIET verhogen.
   */
  resetKey?: number;
}

function createEmptyGrid(headers: readonly string[], rowCount: number): string[][] {
  return Array.from({ length: rowCount }, () =>
    Array.from({ length: headers.length }, () => "")
  );
}

function padToRows(rows: string[][], colCount: number, rowCount: number): string[][] {
  const result = rows.map((r) => {
    const arr = r.slice(0, colCount);
    while (arr.length < colCount) arr.push("");
    return arr;
  });
  while (result.length < rowCount) {
    result.push(Array.from({ length: colCount }, () => ""));
  }
  return result;
}

export default function EditableSheetTable({
  headers,
  initialData,
  onCellBlur,
  dataRowCount,
  rowAction,
  cellRenderers,
  readOnly = false,
  showRowNumbers = false,
  resetKey = 0,
  rowColorClass,
}: EditableSheetTableProps) {
  const colCount = (headers as string[]).length;
  const totalDataRows = dataRowCount ?? initialData?.length ?? 0;
  const effectiveMinRows = readOnly ? 0 : MIN_ROWS;
  const rowCount = Math.max(effectiveMinRows, totalDataRows);
  const isWideAddressColumn = (header: string) =>
    header === "Volledig adress" || header === "Adres";

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [fillerCols, setFillerCols] = useState(0);
  const FILLER_CELL_PX = 64; // 4rem

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const table = tableRef.current;
    if (!wrapper || !table) return;

    const recompute = () => {
      const wrapperWidth = wrapper.clientWidth;
      const tableWidth = table.getBoundingClientRect().width;
      const contentWidth = Math.max(0, tableWidth - fillerCols * FILLER_CELL_PX);
      const need = Math.max(0, Math.floor((wrapperWidth - contentWidth) / FILLER_CELL_PX));
      if (need !== fillerCols) setFillerCols(need);
    };

    recompute();
    const ro = new ResizeObserver(() => recompute());
    ro.observe(wrapper);
    ro.observe(table);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillerCols, colCount, rowCount, showRowNumbers, readOnly]);

  function focusFirstInteractiveCell(cell: HTMLElement) {
    const focusable = cell.querySelector<HTMLElement>(
      'input,textarea,select,button,a,[tabindex]:not([tabindex="-1"])'
    );
    if (focusable) focusable.focus();
  }

  function handleArrowNavigation(
    e: React.KeyboardEvent<HTMLDivElement>,
    currentRow: number,
    currentCol: number
  ) {
    const maxRow = Math.max(0, totalDataRows - 1);
    const maxCol = Math.max(0, colCount - 1);

    let nextRow = currentRow;
    let nextCol = currentCol;

    if (e.key === "ArrowUp") nextRow = Math.max(0, currentRow - 1);
    else if (e.key === "ArrowDown") nextRow = Math.min(maxRow, currentRow + 1);
    else if (e.key === "ArrowLeft") nextCol = Math.max(0, currentCol - 1);
    else if (e.key === "ArrowRight") nextCol = Math.min(maxCol, currentCol + 1);
    else return;

    e.preventDefault();
    const tableEl = tableRef.current;
    if (!tableEl) return;

    const nextTd = tableEl.querySelector<HTMLElement>(
      `td[data-cell-row="${nextRow}"][data-cell-col="${nextCol}"]`
    );
    if (!nextTd) return;
    focusFirstInteractiveCell(nextTd);
  }

  const [values, setValues] = useState<string[][]>(() =>
    initialData ? padToRows(initialData, colCount, rowCount) : createEmptyGrid(headers, rowCount)
  );

  // Alleen resetten als resetKey verandert (= na een echte server-fetch),
  // NIET op elke initialData-wijziging. Zo verdwijnt de flash bij cel-opslaan.
  useEffect(() => {
    if (!initialData) return;
    setValues(padToRows(initialData, colCount, rowCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, colCount, rowCount, initialData]);

  const handleChange = useCallback(
    (row: number, col: number, value: string) => {
      setValues((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = value;
        return next;
      });
    },
    []
  );

  const handleBlur = useCallback(
    (row: number, col: number) => {
      const header = headers[col];
      const value = values[row]?.[col] ?? "";
      onCellBlur?.(row, header, value);
    },
    [headers, values, onCellBlur]
  );

  const hasActionCol = !readOnly && Boolean(rowAction);

  return (
    <div
      ref={wrapperRef}
      className="overflow-x-auto pb-3 rounded-xl border-2 border-stone-300 bg-white shadow-sm"
      style={{ scrollbarGutter: "stable both-edges" }}
      onKeyDownCapture={(e) => {
        if (!showRowNumbers) return;
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
        const target = e.target as HTMLElement | null;
        const td = target?.closest?.('td[data-cell-row][data-cell-col]') as HTMLElement | null;
        if (!td) return;
        const cellRow = Number(td.getAttribute("data-cell-row"));
        const cellCol = Number(td.getAttribute("data-cell-col"));
        if (!Number.isFinite(cellRow) || !Number.isFinite(cellCol)) return;
        if (cellRow < 0 || cellRow >= totalDataRows) return;
        handleArrowNavigation(e, cellRow, cellCol);
      }}
    >
      <div className="mobile-table-scale">
        <table ref={tableRef} className="w-full min-w-max border-collapse text-left text-sm">
          <thead>
            <tr className="bg-stone-100">
              {showRowNumbers && (
                <th className="sticky left-0 z-30 w-8 border border-stone-300 bg-white px-1 py-2 text-center text-xs font-medium text-stone-800">
                  #
                </th>
              )}
              {hasActionCol && (
                <th className="w-8 border border-stone-300" />
              )}
              {headers.map((h) => (
                <th
                  key={h}
                  className={`whitespace-nowrap border border-stone-300 px-2 py-2 font-medium text-stone-800 ${
                    isWideAddressColumn(h) ? "min-w-[22rem]" : ""
                  }`}
                >
                  {h}
                </th>
              ))}
              {Array.from({ length: fillerCols }).map((_, idx) => (
                <th
                  key={`__fill_h_${idx}`}
                  className="whitespace-nowrap border border-stone-300 px-2 py-2 font-medium text-stone-800 w-16 min-w-[4rem]"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((row, i) => {
              const isDataRow = i < totalDataRows;
              const colorCls = isDataRow ? (rowColorClass?.(i) ?? "") : "";
              return (
                <tr key={i} className={colorCls}>
                  {showRowNumbers && (
                    <td className={`sticky left-0 z-30 w-8 border border-stone-300 px-1 py-1 text-center text-xs text-stone-700 ${colorCls || "bg-white"}`}>
                      {isDataRow ? i + 1 : ""}
                    </td>
                  )}
                  {hasActionCol && (
                    <td className="w-8 border border-stone-300 p-0 align-middle">
                      {isDataRow ? (
                        <button
                          type="button"
                          onClick={() => rowAction!(i)}
                          className="flex w-full items-center justify-center py-1 text-stone-400 transition hover:text-red-600"
                          title="Verwijder order"
                          aria-label="Verwijder order"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0V5a1 1 0 011-1h4a1 1 0 011 1v2" />
                          </svg>
                        </button>
                      ) : null}
                    </td>
                  )}
                  {row.map((cellValue, j) => {
                    const header = headers[j];
                    const wide = isWideAddressColumn(header);
                    return (
                      <td
                        key={j}
                        className={`min-w-[4rem] border border-stone-300 p-0 align-top ${
                          wide ? "min-w-[22rem]" : ""
                        }`}
                        data-cell-row={i}
                        data-cell-col={j}
                      >
                        {readOnly ? (
                          <span
                            className={`block px-2 py-1.5 text-sm text-stone-700 ${
                              wide ? "whitespace-normal" : "whitespace-nowrap"
                            }`}
                          >
                            {cellValue ?? ""}
                          </span>
                        ) : (
                          (() => {
                            const customRenderer = cellRenderers?.[header];
                            const onSave = (newValue: string) => {
                              handleChange(i, j, newValue);
                              onCellBlur?.(i, header, newValue);
                            };
                            return customRenderer ? (
                              customRenderer(i, cellValue, onSave)
                            ) : (
                              <input
                                type="text"
                                value={cellValue}
                                onChange={(e) => handleChange(i, j, e.target.value)}
                                onBlur={() => handleBlur(i, j)}
                                className="w-full min-w-[4rem] border-0 bg-transparent px-2 py-1.5 text-stone-700 outline-none focus:bg-koopje-orange-light/30 focus:ring-1 focus:ring-koopje-orange/50"
                                aria-label={`Rij ${i + 1}, ${header}`}
                              />
                            );
                          })()
                        )}
                      </td>
                    );
                  })}
                  {Array.from({ length: fillerCols }).map((_, idx) => (
                    <td
                      key={`__fill_${i}_${idx}`}
                      className="w-16 min-w-[4rem] border border-stone-300 p-0 align-top"
                      aria-hidden="true"
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
