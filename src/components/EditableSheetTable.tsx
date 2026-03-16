"use client";

import { useState, useCallback, useEffect } from "react";

const ROWS = 50;

interface EditableSheetTableProps {
  headers: readonly string[];
  /** Optioneel: data uit Ritjes voor vandaag (bv. van API). Elke rij is een array van celwaarden in de volgorde van headers. Bij wijziging wordt de tabel bijgewerkt. */
  initialData?: string[][];
  /** Wordt aangeroepen bij onBlur van een cel: (rowIndex, header, value). Gebruik om wijzigingen naar de backend te persisten. */
  onCellBlur?: (rowIndex: number, header: string, value: string) => void;
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

export default function EditableSheetTable({ headers, initialData, onCellBlur }: EditableSheetTableProps) {
  const colCount = (headers as string[]).length;
  const [values, setValues] = useState<string[][]>(() =>
    initialData ? padToRows(initialData, colCount) : createEmptyGrid(headers)
  );

  useEffect(() => {
    if (initialData) {
      setValues(padToRows(initialData, colCount));
    }
  }, [initialData, colCount]);

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

  return (
    <div className="overflow-x-auto rounded-xl border-2 border-stone-300 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead>
          <tr className="bg-stone-100">
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
          {values.map((row, i) => (
            <tr key={i}>
              {row.map((cellValue, j) => (
                <td
                  key={j}
                  className="min-w-[4rem] border border-stone-300 p-0 align-top"
                >
                  <input
                    type="text"
                    value={cellValue}
                    onChange={(e) => handleChange(i, j, e.target.value)}
                    onBlur={() => handleBlur(i, j)}
                    className="w-full min-w-[4rem] border-0 bg-transparent px-2 py-1.5 text-stone-700 outline-none focus:bg-koopje-orange-light/30 focus:ring-1 focus:ring-koopje-orange/50"
                    aria-label={`Rij ${i + 1}, ${headers[j]}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
