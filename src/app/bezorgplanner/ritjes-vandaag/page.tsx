"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import EditableSheetTable from "@/components/EditableSheetTable";
import RitjesRouteControls from "@/components/RitjesRouteControls";
import SparrenMetSientje from "@/components/SparrenMetSientje";
import ProductenCell from "@/components/ProductenCell";
import OpmerkingKlantCell from "@/components/OpmerkingKlantCell";
import JaNeeCell from "@/components/JaNeeCell";
import {
  RITJES_HEADERS,
  ordersToTableRows,
  ritjesCellToPayload,
  sortRitjesOrdersNewestFirst,
  type RitjesOrderFromApi,
} from "@/lib/ritjes-mapping";
import StuurAppjesButton from "@/components/StuurAppjesButton";

function normalizeToE164(input: string): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  // remove common separators
  const compact = s.replace(/[()\s-]/g, "");
  if (!compact) return null;
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("0")) return `+31${compact.slice(1)}`;
  // fallback: digits only
  if (/^\d{8,15}$/.test(compact)) return `+${compact}`;
  return null;
}

function extractPhoneFromBelLink(value: string): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  // tel:+316...
  if (v.toLowerCase().startsWith("tel:")) return normalizeToE164(v.slice(4));
  // https://call.ctrlq.org/+316...
  try {
    const url = new URL(v);
    if (url.hostname.toLowerCase().includes("call.ctrlq.org")) {
      const path = url.pathname.replace(/^\//, "");
      return normalizeToE164(path);
    }
  } catch {
    // ignore
  }
  // Spreadsheet-style formula: =HYPERLINK("https://call.ctrlq.org/"&"+316...";"Bel ...")
  const plusMatch = v.match(/(\+\d{8,15})/);
  if (plusMatch) return plusMatch[1];
  return normalizeToE164(v);
}

export default function RitjesVandaagPage() {
  const [orders, setOrders] = useState<RitjesOrderFromApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"alle" | "morgen">("alle");
  // Verhoog dit ALLEEN na een echte server-fetch zodat EditableSheetTable zijn waarden reset.
  // Cel-edits mogen dit NIET verhogen (dat veroorzaakt de page-flash).
  const [tableResetKey, setTableResetKey] = useState(0);
  /** Gedeeld met Route genereren en Sparren met Sientje (OpenAI-context). */
  const [vertrektijd, setVertrektijd] = useState("10:30");

  const fetchRitjes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ritjes-vandaag?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setOrders(sortRitjesOrdersNewestFirst(data.orders ?? []));
      setTableResetKey((k) => k + 1); // tabel resetten na echte fetch
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Pas één order in de lokale state aan zonder een server-fetch te triggeren. */
  const patchOrderInState = useCallback(
    (rowIndex: number, fields: Record<string, unknown>) => {
      setOrders((prev) =>
        prev.map((o, i) => (i === rowIndex ? { ...o, ...fields } : o))
      );
    },
    []
  );

  useEffect(() => {
    fetchRitjes();
  }, [fetchRitjes]);

  const visibleRows = useMemo(() => {
    const filtered =
      activeTab === "morgen"
        ? orders
            .map((o, idx) => ({ o, idx }))
            .filter((x) => x.o.in_morgen_tab === true)
        : orders
            .map((o, idx) => ({ o, idx }))
            .filter((x) => x.o.in_morgen_tab !== true);
    return {
      orders: filtered.map((x) => x.o),
      sourceIndices: filtered.map((x) => x.idx),
    };
  }, [orders, activeTab]);

  const tableRows = useMemo(
    () => ordersToTableRows(visibleRows.orders),
    [visibleRows.orders]
  );

  const RIT_COLORS: Record<number, string> = {
    1: "bg-green-50",
    2: "bg-red-50",
    3: "bg-blue-50",
  };

  const rowColorClass = useCallback(
    (rowIndex: number): string | undefined => {
      const sourceIndex = visibleRows.sourceIndices[rowIndex];
      if (sourceIndex == null) return undefined;
      const order = orders[sourceIndex];
      if (!order) return undefined;
      const rit = (order as any).rit_nummer as number | null | undefined;
      if (!rit) return undefined;
      return RIT_COLORS[rit] ?? "bg-purple-50";
    },
    [orders, visibleRows.sourceIndices]
  );

  const deleteOrder = useCallback(
    async (rowIndex: number) => {
      const sourceIndex = visibleRows.sourceIndices[rowIndex];
      if (sourceIndex == null || sourceIndex < 0 || sourceIndex >= orders.length) return;
      const order = orders[sourceIndex];
      const id = order?.id as string | undefined;
      const orderNummer = String((order as any)?.order_nummer ?? "").trim();
      if (!id) return;

      const ok = window.confirm(
        `Order verwijderen uit Ritjes voor vandaag?\n\n${orderNummer || id}\n\nDit verwijdert de order definitief uit het systeem.`
      );
      if (!ok) return;

      // Optimistisch: verwijder direct uit state
      setOrders((prev) => prev.filter((_, i) => i !== sourceIndex));
      setTableResetKey((k) => k + 1);
      try {
        const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
        if (!res.ok) {
          // Delete is niet echt gelukt op server; herstel state uit DB.
          await fetchRitjes();
        }
      } catch {
        // Rollback bij fout
        await fetchRitjes();
      }
    },
    [orders, visibleRows.sourceIndices, fetchRitjes]
  );

  const cellRenderers = useMemo(
    () => ({
      "Meenemen in planning (anders veranderen naar nee)": (rowIndex: number, value: string, onSave: (v: string) => void) => (
        <JaNeeCell value={value} onSave={onSave} isDataRow={rowIndex < orders.length} />
      ),
      "Betaald?": (rowIndex: number, value: string, onSave: (v: string) => void) => (
        <JaNeeCell value={value} onSave={onSave} isDataRow={rowIndex < orders.length} />
      ),
      "Adress URL": (_rowIndex: number, value: string) =>
        value ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate px-2 py-1.5 text-sm text-koopje-orange underline underline-offset-2 hover:text-koopje-orange/80"
          >
            📍 Kaart
          </a>
        ) : (
          <span className="block px-2 py-1.5 text-sm text-stone-300">—</span>
        ),
      "Bel link": (_rowIndex: number, value: string) => {
        const sourceIndex = visibleRows.sourceIndices[_rowIndex];
        const rowOrder =
          sourceIndex != null && sourceIndex >= 0 ? orders[sourceIndex] : null;
        const naam = rowOrder
          ? String((rowOrder as any).naam ?? "").trim()
          : "";
        const label = naam ? `Bel ${naam}` : "Bellen";
        const order = rowOrder as any;
        const phone =
          normalizeToE164(String(order?.telefoon_e164 ?? "")) ??
          normalizeToE164(String(order?.telefoon_nummer ?? "")) ??
          extractPhoneFromBelLink(value);
        const href = phone ? `tel:${phone}` : null;
        return href ? (
          <a
            href={href}
            className="block truncate px-2 py-1.5 text-sm text-koopje-orange underline underline-offset-2 hover:text-koopje-orange/80"
          >
            📞 {label}
          </a>
        ) : (
          <span className="block px-2 py-1.5 text-sm text-stone-300">—</span>
        );
      },
      "Product(en)": (rowIndex: number, value: string, _onSave: (v: string) => void) => {
        const sourceIndex = visibleRows.sourceIndices[rowIndex];
        if (sourceIndex == null || sourceIndex < 0) return null;
        const order = orders[sourceIndex];
        const id = order?.id as string | undefined;
        const lineItemsJson =
          order != null ? (order.line_items_json as string | null | undefined) ?? null : null;
        const bestellingTotaalPrijs =
          order != null &&
          typeof (order as any).bestelling_totaal_prijs === "number"
            ? ((order as any).bestelling_totaal_prijs as number)
            : null;
        const handleSaveMulti = id
          ? async (fields: Record<string, unknown>) => {
              // Update orders state + reset tabel zodat producten-tekst en prijs direct zichtbaar zijn.
              // tableResetKey hier wél verhogen is OK: het is een expliciete "Opslaan" actie.
              patchOrderInState(sourceIndex, fields);
              setTableResetKey((k) => k + 1);
              await fetch(`/api/orders/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fields),
              });
            }
          : undefined;
        return (
          <ProductenCell
            value={value}
            lineItemsJson={lineItemsJson}
            bestellingTotaalPrijs={bestellingTotaalPrijs}
            onSaveMulti={handleSaveMulti}
          />
        );
      },
      "Opmerkingen klant": (rowIndex: number, value: string) => {
        const sourceIndex = visibleRows.sourceIndices[rowIndex];
        if (sourceIndex == null || sourceIndex < 0) return null;
        const order = orders[sourceIndex];
        const id = order?.id as string | undefined;
        const handleSave = id
          ? async (nextValue: string) => {
              const payload = { opmerkingen_klant: nextValue.trim() || null };
              patchOrderInState(sourceIndex, payload);
              await fetch(`/api/orders/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            }
          : undefined;
        return <OpmerkingKlantCell value={String(value ?? "")} onSave={handleSave} />;
      },
    }),
    [orders, visibleRows.sourceIndices, deleteOrder, patchOrderInState]
  );

  const handleCellBlur = useCallback(
    async (rowIndex: number, header: string, value: string) => {
      const sourceIndex = visibleRows.sourceIndices[rowIndex];
      if (sourceIndex == null || sourceIndex < 0 || sourceIndex >= orders.length) return;
      const order = orders[sourceIndex];
      const id = order?.id as string | undefined;
      if (!id) return;
      const payload = ritjesCellToPayload(header, value);
      if (!payload || Object.keys(payload).length === 0) return;
      // Optimistisch: update direct de lokale order-state, GEEN fetchRitjes → geen page-flash
      patchOrderInState(sourceIndex, payload);
      // Fire-and-forget PATCH, maar herstel vanuit server als opslaan mislukt.
      fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((res) => {
          if (!res.ok) {
            // UI kan anders "ja/tijdslot" tonen terwijl DB-update faalde.
            // Dan klopt selectie voor "Stuur appjes" niet.
            fetchRitjes();
          }
        })
        .catch(() => {
          // Bij netwerk-fout: herlaad data
          fetchRitjes();
        });
    },
    [orders, visibleRows.sourceIndices, patchOrderInState, fetchRitjes]
  );

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto w-full max-w-none px-4 py-8 sm:px-6 sm:py-12">
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
            <RitjesRouteControls
              vertrektijd={vertrektijd}
              onVertrektijdChange={setVertrektijd}
              onRouteGenerated={fetchRitjes}
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SparrenMetSientje
              ritjesOrders={visibleRows.orders}
              vertrektijd={vertrektijd}
              onSlotsUpdated={fetchRitjes}
            />
            <StuurAppjesButton
              huidigeRitjesOrders={visibleRows.orders as any}
              onBeforeOpen={fetchRitjes}
            />
            <button
              type="button"
              onClick={fetchRitjes}
              disabled={loading}
              className="rounded-xl border border-koopje-black/20 bg-white px-4 py-2 text-sm font-medium text-koopje-black transition hover:bg-koopje-black/5 disabled:opacity-50"
            >
              {loading ? "Laden…" : "Verversen"}
            </button>
          </div>

          <div className="mb-4 inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("alle")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                activeTab === "alle"
                  ? "bg-white text-koopje-black shadow-sm"
                  : "text-stone-600 hover:text-koopje-black"
              }`}
            >
              Alle ritten ({orders.filter((o) => o.in_morgen_tab !== true).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("morgen")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                activeTab === "morgen"
                  ? "bg-white text-koopje-black shadow-sm"
                  : "text-stone-600 hover:text-koopje-black"
              }`}
            >
              Morgen ({orders.filter((o) => o.in_morgen_tab === true).length})
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : (
            <EditableSheetTable
              headers={RITJES_HEADERS}
              initialData={tableRows}
              onCellBlur={handleCellBlur}
              dataRowCount={visibleRows.orders.length}
              rowAction={deleteOrder}
              cellRenderers={cellRenderers}
              resetKey={tableResetKey}
              showRowNumbers
              rowColorClass={rowColorClass}
            />
          )}
        </div>
      </main>
    </>
  );
}
