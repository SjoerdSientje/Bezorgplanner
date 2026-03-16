import { ReactNode } from "react";

interface SheetTableProps {
  headers: string[];
  children?: ReactNode;
  emptyMessage?: string;
}

export default function SheetTable({
  headers,
  children,
  emptyMessage = "Nog geen gegevens",
}: SheetTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50">
            {headers.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-3 py-2.5 font-medium text-stone-700"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-stone-600">
          {children ?? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-3 py-6 text-center text-stone-400"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
