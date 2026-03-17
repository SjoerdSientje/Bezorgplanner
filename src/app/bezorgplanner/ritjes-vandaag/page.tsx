"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import EditableSheetTable from "@/components/EditableSheetTable";
import RitjesRouteControls from "@/components/RitjesRouteControls";
import SparrenMetSientje from "@/components/SparrenMetSientje";
import ProductenCell from "@/components/ProductenCell";
import {
  RITJES_HEADERS,
  ordersToTableRows,
  ritjesCellToPayload,
  type RitjesOrderFromApi,
} from "@/lib/ritjes-mapping";
import StuurAppjesButton from "@/components/StuurAppjesButton";

export default function RitjesVandaagPage() {
  const [orders, setOrders] = useState<RitjesOrderFromApi[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRitjes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ritjes-vandaag?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRitjes();
  }, [fetchRitjes]);

  const tableRows = useMemo(() => ordersToTableRows(orders), [orders]);

  const deleteOrder = useCallback(
    async (rowIndex: number) => {
      if (rowIndex < 0 || rowIndex >= orders.length) return;
      const order = orders[rowIndex];
      const id = order?.id as string | undefined;
      const orderNummer = String((order as any)?.order_nummer ?? "").trim();
      if (!id) return;

      const ok = window.confirm(
        `Order verwijderen uit Ritjes voor vandaag?\n\n${orderNummer || id}\n\nDit verwijdert de order definitief uit het systeem.`
      );
      if (!ok) return;

      try {
        const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
        if (res.ok) {
          await fetchRitjes();
        }
      } catch {
        // stil falen of later toast
      }
    },
    [orders, fetchRitjes]
  );

  const cellRenderers = useMemo(
    () => ({
      "Product(en)": (rowIndex: number, value: string) => {
        const order = orders[rowIndex];
        const lineItemsJson =
          order != null ? (order.line_items_json as string | null | undefined) ?? null : null;
        return <ProductenCell value={value} lineItemsJson={lineItemsJson} />;
      },
    }),
    [orders, deleteOrder]
  );

  const handleCellBlur = useCallback(
    async (rowIndex: number, header: string, value: string) => {
      if (rowIndex < 0 || rowIndex >= orders.length) return;
      const order = orders[rowIndex];
      const id = order?.id as string | undefined;
      if (!id) return;
      const payload = ritjesCellToPayload(header, value);
      if (!payload || Object.keys(payload).length === 0) return;
      try {
        const res = await fetch(`/api/orders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          await fetchRitjes();
        }
      } catch {
        // stil falen of later toast
      }
    },
    [orders, fetchRitjes]
  );

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/bezorgplanner"
                className="text-koopje-black/60 transition hover:text-koopje-black"
                aria-label="Terug"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
                Ritjes voor vandaag
              </h1>
            </div>
            <RitjesRouteControls onRouteGenerated={fetchRitjes} />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SparrenMetSientje
              ritjesOrders={orders}
              onSlotsUpdated={fetchRitjes}
            />
            <StuurAppjesButton />
            <button
              type="button"
              onClick={fetchRitjes}
              disabled={loading}
              className="rounded-xl border border-koopje-black/20 bg-white px-4 py-2 text-sm font-medium text-koopje-black transition hover:bg-koopje-black/5 disabled:opacity-50"
            >
              {loading ? "Laden…" : "Verversen"}
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : (
            <EditableSheetTable
              key={orders.length}
              headers={RITJES_HEADERS}
              initialData={tableRows}
              onCellBlur={handleCellBlur}
              rowActions={(rowIndex) =>
                orders[rowIndex]?.id ? (
                  <button
                    type="button"
                    onClick={() => deleteOrder(rowIndex)}
                    className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-400 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                    title="Verwijder order"
                    aria-label="Verwijder order"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0V5a1 1 0 011-1h4a1 1 0 011 1v2"
                      />
                    </svg>
                  </button>
                ) : null
              }
              cellRenderers={cellRenderers}
            />
          )}
        </div>
      </main>
    </>
  );
}
