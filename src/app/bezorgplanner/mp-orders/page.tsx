"use client";

import { useEffect, useCallback, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";

const HEADERS = [
  "Order Nummer",
  "Naam",
  "Bezorger",
  "Hoe is er betaald?",
  "Betaald bedrag",
  "Bezorgdatum",
  "Telefoonnummer",
  "Product(en)",
  "Totaal Prijs",
  "Adres",
  "Email",
  "Aantal Fietsen",
  "Nummer in E.164",
  "Link Aankoopbewijs",
];

type MpOrder = {
  id: string;
  type: string | null;
  order_nummer: string | null;
  naam: string | null;
  bezorger_naam: string | null;
  betaalmethode: string | null;
  betaald_bedrag: number | null;
  datum: string | null;
  telefoon_nummer: string | null;
  producten: string | null;
  bestelling_totaal_prijs: number | null;
  volledig_adres: string | null;
  email: string | null;
  aantal_fietsen: number | null;
  telefoon_e164: string | null;
  link_aankoopbewijs: string | null;
};

function cel(o: MpOrder, col: string): string {
  switch (col) {
    case "Order Nummer": return o.order_nummer ?? "";
    case "Naam": return o.naam ?? "";
    case "Bezorger": return o.bezorger_naam ?? "";
    case "Hoe is er betaald?": return o.betaalmethode ?? "";
    case "Betaald bedrag": return o.betaald_bedrag != null ? String(o.betaald_bedrag) : "";
    case "Bezorgdatum": {
      if (!o.datum) return "";
      // Formaat: winkelverkoop op DD-MM-YYYY
      const d = new Date(o.datum + "T00:00:00");
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return o.type === "mp_winkel" ? `winkelverkoop op ${dd}-${mm}-${yyyy}` : `${dd}-${mm}-${yyyy}`;
    }
    case "Telefoonnummer": return o.telefoon_nummer ?? "";
    case "Product(en)": return o.producten ?? "";
    case "Totaal Prijs": return o.bestelling_totaal_prijs != null ? String(o.bestelling_totaal_prijs) : "";
    case "Adres": return o.volledig_adres ?? "";
    case "Email": return o.email ?? "";
    case "Aantal Fietsen": return o.aantal_fietsen != null ? String(o.aantal_fietsen) : "";
    case "Nummer in E.164": return o.telefoon_e164 ?? "";
    case "Link Aankoopbewijs": return o.link_aankoopbewijs ?? "";
    default: return "";
  }
}

export default function MPOrdersPage() {
  const [orders, setOrders] = useState<MpOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/mp-orders?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/afgeronde-orders" className="text-koopje-black/60 transition hover:text-koopje-black" aria-label="Terug">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">MP orders</h1>
            </div>
            <button
              type="button"
              onClick={fetchOrders}
              disabled={loading}
              className="rounded-xl border border-koopje-black/20 bg-white px-4 py-2 text-sm font-medium text-koopje-black transition hover:bg-koopje-black/5 disabled:opacity-50"
            >
              {loading ? "Laden…" : "Verversen"}
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-koopje-black/60">Geen MP orders gevonden.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border-2 border-stone-300 bg-white shadow-sm">
              <table className="w-full min-w-max border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-stone-100">
                    {HEADERS.map((h) => (
                      <th key={h} className="whitespace-nowrap border border-stone-300 px-3 py-2 font-medium text-stone-800">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-stone-50">
                      {HEADERS.map((h) => (
                        <td key={h} className="whitespace-nowrap border border-stone-300 px-3 py-2 text-stone-700">
                          {h === "Link Aankoopbewijs" && cel(o, h) ? (
                            <a
                              href={cel(o, h)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-koopje-orange underline"
                            >
                              Bekijk PDF
                            </a>
                          ) : cel(o, h)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
