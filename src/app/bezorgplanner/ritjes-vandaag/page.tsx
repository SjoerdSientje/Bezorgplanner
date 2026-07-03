"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import EditableSheetTable from "@/components/EditableSheetTable";
import RitjesRouteControls from "@/components/RitjesRouteControls";
import type { RoutePickOrder } from "@/components/RouteOrderPicker";
import SparrenMetSientje from "@/components/SparrenMetSientje";
import ProductenCell from "@/components/ProductenCell";
import OpmerkingKlantCell from "@/components/OpmerkingKlantCell";
import JaNeeCell from "@/components/JaNeeCell";
import AlleRittenTabel, { type AlleRittenOrder } from "@/components/AlleRittenTabel";
import LijstSjoerd from "@/components/LijstSjoerd";
import {
  RITJES_HEADERS,
  ordersToTableRows,
  ritjesCellToPayload,
  sortRitjesOrdersNewestFirst,
  sortRoutesTabOrders,
  type RitjesOrderFromApi,
} from "@/lib/ritjes-mapping";
import { comparePlanningDatumKeys, planningDatumGroupLabel } from "@/lib/planning-date";
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
  const [activeTab, setActiveTab] = useState<"alle" | "sjoerd" | "morgen">("alle");
  // Verhoog dit ALLEEN na een echte server-fetch zodat EditableSheetTable zijn waarden reset.
  // Cel-edits mogen dit NIET verhogen (dat veroorzaakt de page-flash).
  const [tableResetKey, setTableResetKey] = useState(0);
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

  /** Patch op basis van order-ID (voor AlleRittenTabel / LijstSjoerd). */
  const patchOrderById = useCallback(
    (id: string, fields: Record<string, unknown>) => {
      setOrders((prev) =>
        prev.map((o) => (String(o.id ?? "") === id ? { ...o, ...fields } : o))
      );
      fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      }).catch(() => fetchRitjes());
    },
    [fetchRitjes]
  );

  const handleReorderComplete = useCallback(
    async (
      updates: Array<{
        id: string;
        route_nummer: number | null;
        rit_nummer?: number;
        aankomsttijd_slot: string;
      }>
    ) => {
      if (updates.length > 0) {
        setOrders((prev) =>
          prev.map((o) => {
            const u = updates.find((x) => x.id === String(o.id ?? ""));
            return u
              ? {
                  ...o,
                  route_nummer: u.route_nummer,
                  rit_nummer: u.rit_nummer ?? (o as { rit_nummer?: number }).rit_nummer,
                  aankomsttijd_slot: u.aankomsttijd_slot,
                }
              : o;
          })
        );
      }
      await fetchRitjes();
    },
    [fetchRitjes]
  );

  /** Verwijder order op ID (voor AlleRittenTabel). */
  const deleteOrderById = useCallback(
    async (id: string) => {
      const order = orders.find((o) => String(o.id ?? "") === id);
      const orderNummer = String((order as any)?.order_nummer ?? "").trim();
      const ok = window.confirm(
        `Order verwijderen uit Ritjes voor vandaag?\n\n${orderNummer || id}\n\nDit verwijdert de order definitief.`
      );
      if (!ok) return;
      setOrders((prev) => prev.filter((o) => String(o.id ?? "") !== id));
      setTableResetKey((k) => k + 1);
      try {
        const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
        if (!res.ok) await fetchRitjes();
      } catch {
        await fetchRitjes();
      }
    },
    [orders, fetchRitjes]
  );

  useEffect(() => {
    fetchRitjes();
  }, [fetchRitjes]);

  const visibleRows = useMemo(() => {
    let filtered =
      activeTab === "morgen"
        ? orders
            .map((o, idx) => ({ o, idx }))
            .filter((x) => x.o.in_morgen_tab === true)
        : orders
            .map((o, idx) => ({ o, idx }))
            .filter((x) => x.o.in_morgen_tab !== true);

    if (activeTab === "morgen" && filtered.length > 1) {
      const sorted = sortRoutesTabOrders(filtered.map((x) => x.o));
      const idxById = new Map(filtered.map((x) => [String(x.o.id ?? ""), x.idx]));
      filtered = sorted.map((o) => ({
        o,
        idx: idxById.get(String(o.id ?? "")) ?? 0,
      }));
    }

    return {
      orders: filtered.map((x) => x.o),
      sourceIndices: filtered.map((x) => x.idx),
    };
  }, [orders, activeTab]);

  const tableRows = useMemo(
    () => ordersToTableRows(visibleRows.orders),
    [visibleRows.orders]
  );

  const sjoerdOrders = useMemo((): RoutePickOrder[] => {
    return orders
      .filter((o) => o.in_morgen_tab !== true && o.meenemen_in_planning === true)
      .map((o) => ({
        id: String(o.id ?? "").trim(),
        naam: String(o.naam ?? ""),
        volledig_adres: String(o.volledig_adres ?? ""),
        bezorgtijd_voorkeur: (o.bezorgtijd_voorkeur as string | null | undefined) ?? null,
        aankomsttijd_slot: (o.aankomsttijd_slot as string | null | undefined) ?? null,
      }))
      .filter((o) => o.id);
  }, [orders]);

  const alleRittenOpen = useMemo(
    () => orders.filter((o) => o.in_morgen_tab !== true) as AlleRittenOrder[],
    [orders]
  );

  const alleRittenKlaarzetten = useMemo(
    () => orders.filter((o) => o.in_morgen_tab === true) as AlleRittenOrder[],
    [orders]
  );

  const ROUTE_HEADER_COLORS: Record<number, string> = {
    1: "text-emerald-700",
    2: "text-sky-700",
    3: "text-violet-700",
    4: "text-amber-700",
    5: "text-rose-700",
  };

  // Groepeer de Routes-tab op datum én route_nummer voor aparte secties.
  const routesGroups = useMemo(() => {
    if (activeTab !== "morgen") return null;

    // Bouw positiemap: elke positie in visibleRows.orders
    const datumMap = new Map<string, number[]>();
    for (let pos = 0; pos < visibleRows.orders.length; pos++) {
      const o = visibleRows.orders[pos];
      const datum = String((o as Record<string, unknown>).planning_slot_datum ?? "");
      if (!datumMap.has(datum)) datumMap.set(datum, []);
      datumMap.get(datum)!.push(pos);
    }

    return Array.from(datumMap.entries())
      .sort(([a], [b]) => comparePlanningDatumKeys(a, b))
      .map(([datum, positions]) => {
        const { isToday } = planningDatumGroupLabel(datum);
        const hasRoutes = positions.some((pos) => {
          const rn = Number((visibleRows.orders[pos] as Record<string, unknown>).route_nummer ?? 0);
          return rn > 0;
        });

        if (!hasRoutes) {
          return {
            datum,
            isToday,
            routeSubGroups: [{ routeNum: null as number | null, positions }],
          };
        }

        const routeMap = new Map<number, number[]>();
        const loosePositions: number[] = [];
        for (const pos of positions) {
          const rn = Number((visibleRows.orders[pos] as Record<string, unknown>).route_nummer ?? 0);
          if (rn > 0) {
            if (!routeMap.has(rn)) routeMap.set(rn, []);
            routeMap.get(rn)!.push(pos);
          } else {
            loosePositions.push(pos);
          }
        }
        const routeKeys = Array.from(routeMap.keys()).sort((a, b) => a - b);
        const routeSubGroups: { routeNum: number | null; positions: number[] }[] = routeKeys.map((k) => ({
          routeNum: k,
          positions: routeMap.get(k)!,
        }));
        if (loosePositions.length > 0) routeSubGroups.push({ routeNum: null, positions: loosePositions });

        return { datum, isToday, routeSubGroups };
      });
  }, [activeTab, visibleRows.orders]);

  const RIT_COLORS: Record<number, string> = {
    1: "bg-green-50",
    2: "bg-red-50",
    3: "bg-blue-50",
  };

  const ROUTE_COLORS: Record<number, string> = {
    1: "bg-emerald-50",
    2: "bg-sky-50",
    3: "bg-violet-50",
    4: "bg-amber-50",
    5: "bg-rose-50",
  };

  const rowColorClass = useCallback(
    (rowIndex: number): string | undefined => {
      const sourceIndex = visibleRows.sourceIndices[rowIndex];
      if (sourceIndex == null) return undefined;
      const order = orders[sourceIndex];
      if (!order) return undefined;
      const rit = (order as { rit_nummer?: number | null }).rit_nummer;
      if (rit != null && Number(rit) > 0) {
        return RIT_COLORS[Number(rit)] ?? "bg-purple-50";
      }
      const routeN = (order as { route_nummer?: number | null }).route_nummer;
      if (routeN != null && Number(routeN) > 0) {
        return ROUTE_COLORS[Number(routeN)] ?? "bg-stone-100";
      }
      return undefined;
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
              onRouteGenerated={fetchRitjes}
              sjoerdOrders={sjoerdOrders}
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SparrenMetSientje
              ritjesOrders={visibleRows.orders}
              onSlotsUpdated={fetchRitjes}
            />
            <StuurAppjesButton
              huidigeRitjesOrders={
                orders.filter(
                  (o) => o.in_morgen_tab !== true && o.meenemen_in_planning === true
                ) as any
              }
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
            {(["alle", "sjoerd", "morgen"] as const).map((tab) => {
              const label =
                tab === "alle"
                  ? `Alle ritten (${orders.length})`
                  : tab === "sjoerd"
                  ? `Lijst Sjoerd (${orders.filter((o) => o.in_morgen_tab !== true && o.meenemen_in_planning === true).length})`
                  : `Routes (${orders.filter((o) => o.in_morgen_tab === true).length})`;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab
                      ? "bg-white text-koopje-black shadow-sm"
                      : "text-stone-600 hover:text-koopje-black"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {loading ? (
            <p className="text-sm text-koopje-black/60">Laden…</p>
          ) : activeTab === "alle" ? (
            <div className="space-y-8">
              <section>
                <h2 className="mb-3 text-sm font-semibold text-koopje-black">
                  Openstaande ritten
                  <span className="ml-2 font-normal text-stone-500">
                    ({alleRittenOpen.length})
                  </span>
                </h2>
                {alleRittenOpen.length > 0 ? (
                  <AlleRittenTabel
                    orders={alleRittenOpen}
                    onPatch={patchOrderById}
                    onDelete={deleteOrderById}
                  />
                ) : (
                  <p className="text-sm text-stone-400">Geen openstaande ritten.</p>
                )}
              </section>
              {alleRittenKlaarzetten.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold text-koopje-black">
                    Klaarzetten route
                    <span className="ml-2 font-normal text-stone-500">
                      ({alleRittenKlaarzetten.length})
                    </span>
                  </h2>
                  <AlleRittenTabel
                    orders={alleRittenKlaarzetten}
                    onPatch={patchOrderById}
                    onDelete={deleteOrderById}
                  />
                </section>
              )}
            </div>
          ) : activeTab === "sjoerd" ? (
            // ── Lijst Sjoerd: meenemen=ja orders ─────────────────────────────
            <LijstSjoerd
              orders={orders.filter((o) => o.in_morgen_tab !== true) as AlleRittenOrder[]}
              onPatch={patchOrderById}
              onReorderComplete={handleReorderComplete}
            />
          ) : activeTab === "morgen" && routesGroups ? (
            // ── Routes-tab: gegroepeerd op datum én route ─────────────────────
            <div className="space-y-8">
              {routesGroups.map((group) => {
                const { text: groupTitle, isToday } = planningDatumGroupLabel(group.datum);
                return (
                <div key={group.datum}>
                  {routesGroups.length > 1 && (
                    <h2
                      className={`mb-4 text-base font-semibold ${
                        isToday ? "text-koopje-black" : "text-koopje-orange"
                      }`}
                    >
                      {groupTitle}
                    </h2>
                  )}
                  <div className="space-y-6">
                    {group.routeSubGroups.map((sub) => {
                      const subOrders = sub.positions.map((pos) => visibleRows.orders[pos]);
                      const subTableRows = ordersToTableRows(subOrders);
                      const subSize = sub.positions.length;
                      const subRenderers = Object.fromEntries(
                        Object.entries(cellRenderers).map(([key, fn]) => [
                          key,
                          (ri: number, v: string, os: (val: string) => void) => {
                            if (ri >= subSize) return null;
                            return fn(sub.positions[ri]!, v, os);
                          },
                        ])
                      );
                      const routeLabelColor =
                        sub.routeNum != null
                          ? (ROUTE_HEADER_COLORS[sub.routeNum] ?? "text-stone-700")
                          : "text-stone-700";
                      return (
                        <div key={sub.routeNum ?? "overig"}>
                          {sub.routeNum != null && (
                            <h3 className={`mb-2 text-sm font-semibold ${routeLabelColor}`}>
                              Route {sub.routeNum}
                            </h3>
                          )}
                          <EditableSheetTable
                            headers={RITJES_HEADERS}
                            initialData={subTableRows}
                            onCellBlur={(ri, header, value) =>
                              handleCellBlur(sub.positions[ri]!, header, value)
                            }
                            dataRowCount={subSize}
                            rowAction={(ri) => deleteOrder(sub.positions[ri]!)}
                            cellRenderers={subRenderers}
                            resetKey={tableResetKey}
                            showRowNumbers
                            rowColorClass={(ri) => rowColorClass(sub.positions[ri]!)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
