"use client";

import React, { useState, useCallback, useEffect } from "react";

const ROWS = 50;

interface EditableSheetTableProps {
  headers: readonly string[];
  initialData?: string[][];
  onCellBlur?: (rowIndex: number, header: string, value: string) => void;
  /** Aantal echte datarijen (wordt gebruikt om actie-iconen zichtbaar te maken). */
  dataRowCount?: number;
  /** Optionele actie per data-rij (bijv. prullenbak). */
  rowAction?: (rowIndex: number) => void;
  cellRenderers?: Record<string, (rowIndex: number, value: string, onSave: (v: string) => void) => React.ReactNode>;
  /**
   * Verhoog deze waarde wanneer je de tabel geforceerd wilt resetten vanuit initialData
   * (bijv. na een echte server-fetch). Celwijzigingen mogen deze NIET verhogen.
   */
  resetKey?: number;
}

function createEmptyGrid(headers: readonly string[]): string[][] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: headers.length }, () => "")
  );
}

function padToRows(rows: string[][], colCount: number): string[][] {
  const result = rows.map((r) => {
    const arr = r.slice(0, colCount);
    while (arr.length < colCount) arr.push("");
    return arr;
  });
  while (result.length < ROWS) {
    result.push(Array.from({ length: colCount }, () => ""));
  }
  return result.slice(0, ROWS);
}

export default function EditableSheetTable({
  headers,
  initialData,
  onCellBlur,
  dataRowCount,
  rowAction,
  cellRenderers,
  resetKey = 0,
}: EditableSheetTableProps) {
  const colCount = (headers as string[]).length;
  const [values, setValues] = useState<string[][]>(() =>
    initialData ? padToRows(initialData, colCount) : createEmptyGrid(headers)
  );

  // Alleen resetten als resetKey verandert (= na een echte server-fetch),
  // NIET op elke initialData-wijziging. Zo verdwijnt de flash bij cel-opslaan.
  useEffect(() => {
    if (initialData) {
      setValues(padToRows(initialData, colCount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, colCount]);

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

  const hasActionCol = Boolean(rowAction);
  const totalDataRows = dataRowCount ?? 0;

  return (
    <div className="overflow-x-auto overflow-y-auto rounded-xl border-2 border-stone-300 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead>
          <tr className="bg-stone-100">
            {hasActionCol && (
              <th className="w-8 border border-stone-300" />
            )}
            {headers.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border border-stone-300 px-2 py-2 font-medium text-stone-800"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {values.map((row, i) => {
            const isDataRow = i < totalDataRows;
            return (
              <tr key={i}>
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
                  const customRenderer = cellRenderers?.[header];
                  const onSave = (newValue: string) => {
                    handleChange(i, j, newValue);
                    onCellBlur?.(i, header, newValue);
                  };
                  return (
                    <td key={j} className="min-w-[4rem] border border-stone-300 p-0 align-top">
                      {customRenderer ? (
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
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
