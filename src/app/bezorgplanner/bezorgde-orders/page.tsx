/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import EditableSheetTable from "@/components/EditableSheetTable";

const BEZORGDE_ORDERS_HEADERS = [
  "Order Nummer",
  "Naam",
  "Bezorger",
  "Hoe is er betaald?",
  "Betaald bedrag",
  "Bezorg Datum",
  "Product(en)",
  "Bestelling Totaal Prijs",
  "Volledig adress",
  "Telefoon nummer",
  "Order ID",
  "Aantal fietsen",
  "Email",
  "Betaalmethode",
  "Nummer in E.164 formaat",
];

export default function BezorgdeOrdersPage() {
  type BezorgdeOrder = {
    id: string;
    order_nummer: string | null;
    naam: string | null;
    bezorger_naam: string | null;
    betaalmethode: string | null;
    betaald_bedrag: number | null;
    afgerond_at: string | null;
    producten: string | null;
    bestelling_totaal_prijs: number | null;
    volledig_adres: string | null;
    telefoon_nummer: string | null;
    order_id: string | null;
    aantal_fietsen: number | null;
    email: string | null;
    telefoon_e164: string | null;
  };

  const [orders, setOrders] = useState<BezorgdeOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bezorgde-orders?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      setOrders(Array.isArray(data.orders) ? (data.orders as BezorgdeOrder[]) : []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const tableRows = useMemo(() => {
    const today = new Date();
    const todayDDMMYYYY = `${String(today.getDate()).padStart(2, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${today.getFullYear()}`;

    return orders.map((o) => [
      o.order_nummer ?? "",
      o.naam ?? "",
      o.bezorger_naam ?? "",
      o.betaalmethode ?? "",

      (() => {
        const betaalmethode = String(o.betaalmethode ?? "");
        const wasAlBetaald = betaalmethode.toLowerCase() === "was al betaald";
        if (wasAlBetaald) {
          return o.bestelling_totaal_prijs != null ? String(o.bestelling_totaal_prijs) : "";
        }
        return o.betaald_bedrag != null ? String(o.betaald_bedrag) : "";
      })(),

      // Vereiste: altijd vandaag (DD-MM-YYYY)
      todayDDMMYYYY,
      o.producten ?? "",
      o.bestelling_totaal_prijs != null ? String(o.bestelling_totaal_prijs) : "",
      o.volledig_adres ?? "",
      o.telefoon_nummer ?? "",
      o.order_id ?? "",
      o.aantal_fietsen != null ? String(o.aantal_fietsen) : "",
      o.email ?? "",
      o.betaalmethode ?? "",
      o.telefoon_e164 ?? "",
    ]);
  }, [orders]);

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/afgeronde-orders"
              className="text-koopje-black/60 transition hover:text-koopje-black"
              aria-label="Terug"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
              Bezorgde orders
            </h1>
          </div>

          <p className="mb-4 text-sm text-koopje-black/60">
            Onderstaande tabel toont alle kolommen. Je kunt in elk vakje typen. Scroll horizontaal als niet alles past.
          </p>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : (
            <EditableSheetTable
              headers={BEZORGDE_ORDERS_HEADERS}
              initialData={tableRows}
              dataRowCount={orders.length}
            />
          )}
        </div>
      </main>
    </>
  );
}
