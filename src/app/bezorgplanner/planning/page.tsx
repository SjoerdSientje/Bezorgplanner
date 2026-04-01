"use client";

import { useEffect, useCallback, useState, useMemo, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import ProductenCell from "@/components/ProductenCell";
import OpmerkingKlantCell from "@/components/OpmerkingKlantCell";
import AankoopbewijsCell from "@/components/AankoopbewijsCell";

const PLANNING_HEADERS = [
  "Order nummer",
  "Naam",
  "Aankomsttijd",
  "Tijd opmerking",
  "Adress URL",
  "Bel link",
  "Bestelling Totaal Prijs",
  "Betaalwijze",
  "Betaald?",
  "Aantal fietsen",
  "Product(en)",
  "Opmerking klant",
  "Volledig adress",
  "Ingevuld Telefoon nummer",
  "Order Nummer",
  "Email",
  "Link Aankoopbewijs",
];

type PlanningRow = {
  slot_id: string;
  order_id: string;
  datum: string;
  order_nummer: string;
  naam: string;
  aankomsttijd: string;
  tijd_opmerking: string;
  adres_url: string;
  bel_link: string;
  bestelling_totaal_prijs: string | number;
  betaalwijze: string;
  betaald: string | boolean;
  aantal_fietsen: string | number;
  producten: string;
  line_items_json?: string | null;
  opmerking_klant: string;
  volledig_adres: string;
  telefoon_nummer: string;
  email: string;
  link_aankoopbewijs: string;
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "ja" : "nee";
  return String(value);
}

function normalizeToE164(input: string): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const compact = s.replace(/[()\s-]/g, "");
  if (!compact) return null;
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("0")) return `+31${compact.slice(1)}`;
  if (/^\d{8,15}$/.test(compact)) return `+${compact}`;
  return null;
}

function extractPhoneFromBelLink(value: string): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.toLowerCase().startsWith("tel:")) return normalizeToE164(v.slice(4));
  try {
    const url = new URL(v);
    if (url.hostname.toLowerCase().includes("call.ctrlq.org")) {
      const path = url.pathname.replace(/^\//, "");
      return normalizeToE164(path);
    }
  } catch {
    // ignore
  }
  const plusMatch = v.match(/(\+\d{8,15})/);
  if (plusMatch) return plusMatch[1];
  return normalizeToE164(v);
}

function PlanningTabel({
  rows,
  label,
  labelColor,
  onDeleteSlot,
  onUpdateAankoopbewijs,
}: {
  rows: PlanningRow[];
  label: string;
  labelColor: string;
  onDeleteSlot: (slotId: string, orderNummer: string) => void;
  onUpdateAankoopbewijs: (orderId: string, next: { link: string; email: string }) => void;
}) {
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
  }, [fillerCols, rows.length, PLANNING_HEADERS.length]);

  function focusFirstInteractiveCell(cell: HTMLElement) {
    const focusable = cell.querySelector<HTMLElement>(
      'a,button,input,textarea,select,[tabindex]:not([tabindex="-1"])'
    );
    if (focusable) focusable.focus();
    else cell.focus();
  }

  function handleArrowNavigation(
    e: KeyboardEvent<HTMLDivElement>,
    currentRow: number,
    currentCol: number
  ) {
    const maxRow = Math.max(0, rows.length - 1);
    const maxCol = Math.max(0, PLANNING_HEADERS.length - 1);

    let nextRow = currentRow;
    let nextCol = currentCol;

    if (e.key === "ArrowUp") nextRow = Math.max(0, currentRow - 1);
    else if (e.key === "ArrowDown") nextRow = Math.min(maxRow, currentRow + 1);
    else if (e.key === "ArrowLeft") nextCol = Math.max(0, currentCol - 1);
    else if (e.key === "ArrowRight") nextCol = Math.min(maxCol, currentCol + 1);
    else return;

    e.preventDefault();
    const root = e.currentTarget as HTMLElement;
    const nextTd = root.querySelector<HTMLElement>(
      `td[data-cell-row="${nextRow}"][data-cell-col="${nextCol}"]`
    );
    if (!nextTd) return;
    focusFirstInteractiveCell(nextTd);
  }

  return (
    <div className="mb-8">
      <h2 className={`mb-3 text-base font-semibold ${labelColor}`}>{label}</h2>
      <div
        ref={wrapperRef}
        className="overflow-x-auto pb-3 rounded-xl border-2 border-stone-300 bg-white shadow-sm"
        style={{ scrollbarGutter: "stable both-edges" }}
        onKeyDownCapture={(e) => {
          if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
          const target = e.target as HTMLElement | null;
          const td = target?.closest?.('td[data-cell-row][data-cell-col]') as HTMLElement | null;
          if (!td) return;
          const cellRow = Number(td.getAttribute("data-cell-row"));
          const cellCol = Number(td.getAttribute("data-cell-col"));
          if (!Number.isFinite(cellRow) || !Number.isFinite(cellCol)) return;
          if (cellRow < 0 || cellRow >= rows.length) return;
          handleArrowNavigation(e, cellRow, cellCol);
        }}
      >
        <div className="mobile-table-scale">
          <table ref={tableRef} className="w-full min-w-max border-collapse text-left text-sm">
            <thead>
              <tr className="bg-stone-100">
                <th className="sticky left-0 z-30 w-8 border border-stone-300 bg-white px-1 py-2 text-center text-xs font-medium text-stone-800">
                  #
                </th>
                {/* lege header voor verwijder-kolom */}
                <th className="border border-stone-300 px-1 py-2" />
                {PLANNING_HEADERS.map((h) => (
                  <th
                    key={h}
                    className={`whitespace-nowrap border border-stone-300 px-2 py-2 font-medium text-stone-800 ${
                      h === "Volledig adress" ? "min-w-[22rem]" : ""
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
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={PLANNING_HEADERS.length + 2} className="border border-stone-300 px-2 py-4 text-center text-koopje-black/60">
                    Geen ritjes.
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr key={row.slot_id}>
                    <td className="sticky left-0 z-30 w-8 border border-stone-300 bg-white px-1 py-1 text-center text-xs text-stone-700">
                      {rowIndex + 1}
                    </td>
                    {/* verwijder-knop */}
                    <td className="border border-stone-300 px-1 py-1 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => onDeleteSlot(row.slot_id, String(row.order_nummer))}
                        className="rounded p-1 text-stone-400 transition hover:bg-red-50 hover:text-red-500"
                        title="Verwijder uit planning"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                    <td
                      tabIndex={0}
                      data-cell-row={rowIndex}
                      data-cell-col={0}
                      className="min-w-[4rem] border border-stone-300 p-0 align-top focus:outline-none focus:ring-2 focus:ring-koopje-orange/40"
                    >
                      <Link
                        href={`/bezorgplanner/afronden/${row.order_id}`}
                        className="block px-2 py-1.5 text-koopje-orange underline decoration-koopje-orange underline-offset-2 hover:text-koopje-orange-dark"
                      >
                        {formatCell(row.order_nummer)} afronden
                      </Link>
                    </td>
                    {/* Naam */} 
                    <td
                      tabIndex={0}
                      data-cell-row={rowIndex}
                      data-cell-col={1}
                      className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-2 focus:ring-koopje-orange/40"
                    >
                      {formatCell(row.naam)}
                    </td>
                    {/* Aankomsttijd */} 
                    <td
                      tabIndex={0}
                      data-cell-row={rowIndex}
                      data-cell-col={2}
                      className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-2 focus:ring-koopje-orange/40"
                    >
                      {formatCell(row.aankomsttijd)}
                    </td>
                    {/* Tijd opmerking */} 
                    <td
                      tabIndex={0}
                      data-cell-row={rowIndex}
                      data-cell-col={3}
                      className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-2 focus:ring-koopje-orange/40"
                    >
                      {formatCell(row.tijd_opmerking)}
                    </td>
                    {/* Adress URL */} 
                    <td
                      tabIndex={0}
                      data-cell-row={rowIndex}
                      data-cell-col={4}
                      className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-2 focus:ring-koopje-orange/40"
                    >
                      {row.adres_url ? (
                        <a href={row.adres_url} target="_blank" rel="noopener noreferrer" className="text-koopje-orange underline underline-offset-2">
                          📍 Kaart
                        </a>
                      ) : (
                        ""
                      )}
                    </td>
                    {/* Bel link */} 
                    <td
                      tabIndex={0}
                      data-cell-row={rowIndex}
                      data-cell-col={5}
                      className="min-w-[4rem] border border-stone-300 px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-2 focus:ring-koopje-orange/40"
                    >
                      {(() => {
                        const phone =
                          normalizeToE164(row.telefoon_nummer) ?? extractPhoneFromBelLink(row.bel_link);
                        return phone ? (
                          <a href={`tel:${phone}`} className="text-koopje-orange underline underline-offset-2">
                            📞 Bellen
                          </a>
                        ) : (
                          ""
                        );
                      })()}
                    </td>
                    {/* Rest */} 
                    {[
                      row.bestelling_totaal_prijs,
                      row.betaalwijze,
                      row.betaald,
                      row.aantal_fietsen,
                      row.producten,
                      row.opmerking_klant,
                      row.volledig_adres,
                      row.telefoon_nummer,
                      row.order_nummer,
                      row.email,
                      row.link_aankoopbewijs,
                    ].map((v, i) => (
                      <td
                        key={i}
                        tabIndex={0}
                        data-cell-row={rowIndex}
                        data-cell-col={6 + i}
                        className={`border border-stone-300 px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-2 focus:ring-koopje-orange/40 ${
                          i === 6 ? "min-w-[22rem]" : "min-w-[4rem]"
                        }`}
                      >
                        {(() => {
                          // Product(en): klikbaar (popup) maar niet bewerkbaar
                          const isProductenCol = i === 4;
                          if (isProductenCol) {
                            return (
                              <ProductenCell
                                value={String(row.producten ?? "")}
                                lineItemsJson={row.line_items_json ?? null}
                              />
                            );
                          }

                          const isOpmerkingCol = i === 5;
                          if (isOpmerkingCol) {
                            return <OpmerkingKlantCell value={String(row.opmerking_klant ?? "")} />;
                          }

                          // Link Aankoopbewijs is the last column in the "Rest" array
                          const isLinkCol = i === 10;
                          if (isLinkCol) {
                            return (
                              <AankoopbewijsCell
                                orderId={String(row.order_id ?? "")}
                                link={String(v ?? "")}
                                email={row.email}
                                onUpdated={(next) =>
                                  onUpdateAankoopbewijs(String(row.order_id ?? ""), next)
                                }
                              />
                            );
                          }
                          return formatCell(v);
                        })()}
                      </td>
                    ))}
                    {Array.from({ length: fillerCols }).map((_, idx) => (
                      <td
                        key={`__fill_${rowIndex}_${idx}`}
                        className="w-16 min-w-[4rem] border border-stone-300 p-0 align-top"
                        aria-hidden="true"
                      />
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function PlanningPage() {
  const [rows, setRows] = useState<PlanningRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlanning = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/planning?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteSlot = useCallback(
    async (slotId: string, orderNummer: string) => {
      const ok = window.confirm(
        `Order verwijderen uit planning?\n\n${orderNummer || slotId}\n\nDe order blijft gewoon staan in Ritjes voor vandaag.`
      );
      if (!ok) return;
      // Optimistische UI: rij direct verbergen
      setRows((prev) => prev.filter((r) => r.slot_id !== slotId));
      try {
        const res = await fetch(`/api/planning-slots/${slotId}`, { method: "DELETE" });
        if (!res.ok) {
          // Rollback bij fout
          await fetchPlanning();
        }
      } catch {
        await fetchPlanning();
      }
    },
    [fetchPlanning]
  );

  const updateAankoopbewijs = useCallback(
    (orderId: string, next: { link: string; email: string }) => {
      setRows((prev) =>
        prev.map((r) =>
          String(r.order_id) === String(orderId)
            ? { ...r, link_aankoopbewijs: next.link, email: next.email }
            : r
        )
      );
    },
    []
  );

  useEffect(() => {
    fetchPlanning();
  }, [fetchPlanning]);

  // Groepeer op datum; eerste (vroegste) datum = vandaag / actief, volgende = morgen
  const grouped = useMemo(() => {
    const map = new Map<string, PlanningRow[]>();
    for (const r of rows) {
      const key = r.datum ?? "onbekend";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted;
  }, [rows]);

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto w-full max-w-none px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center justify-between gap-4">
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
              <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Planning</h1>
            </div>
            <button
              type="button"
              onClick={fetchPlanning}
              className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-xs text-koopje-black/60 transition hover:border-koopje-orange hover:text-koopje-orange"
            >
              Verversen
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-koopje-black/60">
              Geen planning. Keur eerst de planning goed op Ritjes voor vandaag.
            </p>
          ) : (
            grouped.map(([datum, datumRows], idx) => (
              <PlanningTabel
                key={datum}
                rows={datumRows}
                label={
                  idx === 0
                    ? `Huidige planning — ${datum}`
                    : `Ritjes voor morgen — ${datum}`
                }
                labelColor={
                  idx === 0 ? "text-koopje-black" : "text-koopje-orange"
                }
                onDeleteSlot={deleteSlot}
                onUpdateAankoopbewijs={updateAankoopbewijs}
              />
            ))
          )}
        </div>
      </main>
    </>
  );
}
