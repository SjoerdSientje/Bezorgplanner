"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProductenCell from "@/components/ProductenCell";
import OpmerkingKlantCell from "@/components/OpmerkingKlantCell";
import type { AlleRittenOrder } from "@/components/AlleRittenTabel";
import { routeStyleForIndex } from "@/lib/route-colors";

const GRID_COLS =
  "grid-cols-[2.75rem_minmax(5.5rem,6.5rem)_2rem_minmax(9rem,1fr)_minmax(7rem,0.8fr)_minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]";

function parseSlotMin(slot: string | null | undefined): number {
  const t = String(slot ?? "").split(" - ")[0].replace(".", ":").trim();
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h)) return 9999;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function routeContainerId(routeNum: number | null): string {
  return routeNum != null ? `route-${routeNum}` : "route-overig";
}

function parseContainerRoute(containerId: string): number | null {
  if (containerId === "route-overig") return null;
  const n = parseInt(containerId.replace("route-", ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function loadRouteVertrektijden(defaultTijd: string): Record<number, string> {
  const map: Record<number, string> = { 1: defaultTijd };
  if (typeof window === "undefined") return map;
  try {
    const raw =
      localStorage.getItem("bezorgplanner.routes.v3") ??
      localStorage.getItem("bezorgplanner.routes.v2");
    if (!raw) return map;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return map;
    arr.forEach((r, i) => {
      const vt = String((r as Record<string, unknown>)?.vertrektijd ?? "").trim();
      if (/^\d{1,2}:\d{2}$/.test(vt)) map[i + 1] = vt;
    });
  } catch {
    // ignore
  }
  return map;
}

function EditableCell({
  value,
  onSave,
  placeholder,
  fontMedium,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  fontMedium?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };

  if (editing) {
    return (
      <input
        autoFocus
        className={`w-full rounded border border-koopje-orange px-1 py-0.5 text-sm focus:outline-none ${fontMedium ? "font-medium" : ""}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(value);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`w-full text-left text-sm hover:underline hover:decoration-dotted ${fontMedium ? "font-medium text-koopje-black" : "text-stone-600"}`}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || (
        <span className="text-stone-300 font-normal text-xs">{placeholder ?? "—"}</span>
      )}
    </button>
  );
}

const HEADERS = [
  "Volgorde",
  "Route",
  "#",
  "Tijdslot",
  "Voorkeurstijd",
  "Adres",
  "Model / Product",
  "Opmerking klant",
  "Email",
];

type RouteGroup = {
  routeNum: number | null;
  orders: AlleRittenOrder[];
};

function sortBySlot(orders: AlleRittenOrder[]): AlleRittenOrder[] {
  return [...orders].sort(
    (a, b) =>
      parseSlotMin(a.aankomsttijd_slot as string) - parseSlotMin(b.aankomsttijd_slot as string)
  );
}

function groupByRoute(orders: AlleRittenOrder[]): RouteGroup[] {
  const filtered = orders.filter((o) => o.meenemen_in_planning === true);
  const hasRoutes = filtered.some((o) => Number(o.route_nummer ?? 0) > 0);

  if (!hasRoutes) {
    return [{ routeNum: null, orders: sortBySlot(filtered) }];
  }

  const routeMap = new Map<number, AlleRittenOrder[]>();
  const loose: AlleRittenOrder[] = [];

  for (const o of filtered) {
    const rn = Number(o.route_nummer ?? 0);
    if (rn > 0) {
      if (!routeMap.has(rn)) routeMap.set(rn, []);
      routeMap.get(rn)!.push(o);
    } else {
      loose.push(o);
    }
  }

  const groups: RouteGroup[] = Array.from(routeMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([routeNum, routeOrders]) => ({
      routeNum,
      orders: sortBySlot(routeOrders),
    }));

  if (loose.length > 0) {
    groups.push({ routeNum: null, orders: sortBySlot(loose) });
  }

  return groups;
}

function groupsToContainers(groups: RouteGroup[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of groups) {
    out[routeContainerId(g.routeNum)] = g.orders.map((o) => String(o.id));
  }
  return out;
}

function findContainer(
  itemId: string,
  containers: Record<string, string[]>
): string | null {
  if (itemId in containers) return itemId;
  for (const [containerId, ids] of Object.entries(containers)) {
    if (ids.includes(itemId)) return containerId;
  }
  return null;
}

function moveWithinContainer(
  containers: Record<string, string[]>,
  orderId: string,
  direction: "up" | "down"
): Record<string, string[]> | null {
  const containerId = findContainer(orderId, containers);
  if (!containerId) return null;

  const items = [...(containers[containerId] ?? [])];
  const idx = items.indexOf(orderId);
  if (idx < 0) return null;

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return null;

  [items[idx], items[swapIdx]] = [items[swapIdx]!, items[idx]!];
  return { ...containers, [containerId]: items };
}

function moveToContainer(
  containers: Record<string, string[]>,
  orderId: string,
  targetContainerId: string
): Record<string, string[]> | null {
  const sourceContainerId = findContainer(orderId, containers);
  if (!sourceContainerId || sourceContainerId === targetContainerId) return null;
  if (!(targetContainerId in containers)) return null;

  const sourceItems = [...(containers[sourceContainerId] ?? [])];
  const targetItems = [...(containers[targetContainerId] ?? [])];
  const idx = sourceItems.indexOf(orderId);
  if (idx < 0) return null;

  sourceItems.splice(idx, 1);
  const insertAt = Math.min(idx, targetItems.length);
  targetItems.splice(insertAt, 0, orderId);

  return {
    ...containers,
    [sourceContainerId]: sourceItems,
    [targetContainerId]: targetItems,
  };
}

type ReorderUpdate = {
  id: string;
  route_nummer: number | null;
  aankomsttijd_slot: string;
};

type RouteOption = { containerId: string; label: string };

function OrderRow({
  order,
  rowNum,
  rowClassName,
  reorderEnabled,
  routeOptions,
  currentContainerId,
  busy,
  onPatch,
  onMoveUp,
  onMoveDown,
  onChangeRoute,
  canMoveUp,
  canMoveDown,
}: {
  order: AlleRittenOrder;
  rowNum: number;
  rowClassName?: string;
  reorderEnabled: boolean;
  routeOptions: RouteOption[];
  currentContainerId: string;
  busy: boolean;
  onPatch: (id: string, fields: Record<string, unknown>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeRoute: (targetContainerId: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const id = String(order.id);

  return (
    <div
      className={`grid ${GRID_COLS} border-b border-stone-100 last:border-0 ${
        rowClassName ?? "bg-white even:bg-stone-50/50"
      }`}
    >
      <div className="flex flex-col items-center justify-center gap-0.5 border border-stone-200 px-0.5 py-1">
        {reorderEnabled ? (
          <>
            <button
              type="button"
              disabled={busy || !canMoveUp}
              onClick={onMoveUp}
              className="flex h-7 w-7 touch-manipulation items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-koopje-orange disabled:opacity-25"
              aria-label="Eén plek omhoog"
              title="Omhoog"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              disabled={busy || !canMoveDown}
              onClick={onMoveDown}
              className="flex h-7 w-7 touch-manipulation items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-koopje-orange disabled:opacity-25"
              aria-label="Eén plek omlaag"
              title="Omlaag"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </>
        ) : (
          <span className="text-xs text-stone-300">—</span>
        )}
      </div>

      <div className="flex items-center border border-stone-200 px-1 py-1">
        {reorderEnabled && routeOptions.length > 1 ? (
          <select
            disabled={busy}
            value={currentContainerId}
            onChange={(e) => onChangeRoute(e.target.value)}
            className="w-full min-w-0 rounded border border-stone-200 bg-white px-1 py-1 text-xs text-koopje-black focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
            aria-label="Route kiezen"
          >
            {routeOptions.map((opt) => (
              <option key={opt.containerId} value={opt.containerId}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1 text-xs text-stone-400">—</span>
        )}
      </div>

      <div className="flex items-center justify-center border border-stone-200 px-1 py-2 text-xs font-medium text-stone-500">
        {rowNum}
      </div>

      <div className="border border-stone-200 px-3 py-2">
        <EditableCell
          value={String(order.aankomsttijd_slot ?? "")}
          onSave={(v) => onPatch(id, { aankomsttijd_slot: v || null })}
          placeholder="Klik om in te vullen"
          fontMedium
        />
      </div>

      <div className="border border-stone-200 px-3 py-2">
        <EditableCell
          value={String(order.bezorgtijd_voorkeur ?? "")}
          onSave={(v) => onPatch(id, { bezorgtijd_voorkeur: v || null })}
          placeholder="—"
        />
      </div>

      <div className="border border-stone-200 px-3 py-2 min-w-0">
        <EditableCell
          value={String(order.volledig_adres ?? "")}
          onSave={(v) => onPatch(id, { volledig_adres: v || null })}
          placeholder="—"
        />
      </div>

      <div className="border border-stone-200 p-0 min-w-0">
        <ProductenCell
          value={String(order.producten ?? "")}
          lineItemsJson={(order.line_items_json as string | null | undefined) ?? null}
          bestellingTotaalPrijs={
            typeof order.bestelling_totaal_prijs === "number" ? order.bestelling_totaal_prijs : null
          }
          onSaveMulti={async (fields) => onPatch(id, fields)}
        />
      </div>

      <div className="border border-stone-200 p-0 min-w-0">
        <OpmerkingKlantCell
          value={String(order.opmerkingen_klant ?? "")}
          onSave={async (v) => onPatch(id, { opmerkingen_klant: v.trim() || null })}
        />
      </div>

      <div className="border border-stone-200 px-3 py-2 min-w-0">
        <EditableCell
          value={String(order.email ?? "")}
          onSave={(v) => onPatch(id, { email: v || null })}
          placeholder="—"
        />
      </div>
    </div>
  );
}

export default function LijstSjoerd({
  orders,
  onPatch,
  onReorderComplete,
  defaultVertrektijd = "10:30",
}: {
  orders: AlleRittenOrder[];
  onPatch: (id: string, fields: Record<string, unknown>) => void;
  onReorderComplete?: (updates: ReorderUpdate[]) => void;
  defaultVertrektijd?: string;
}) {
  const groups = useMemo(() => groupByRoute(orders), [orders]);
  const orderById = useMemo(
    () => new Map(orders.map((o) => [String(o.id), o])),
    [orders]
  );

  const sjoerdCount = orders.filter((o) => o.meenemen_in_planning === true).length;
  const hasSlots = orders.some(
    (o) => o.meenemen_in_planning === true && String(o.aankomsttijd_slot ?? "").trim() !== ""
  );
  const reorderEnabled = hasSlots && sjoerdCount >= 1;

  const [containers, setContainers] = useState<Record<string, string[]>>(() =>
    groupsToContainers(groups)
  );
  const [recalculating, setRecalculating] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  useEffect(() => {
    if (!recalculating) {
      setContainers(groupsToContainers(groups));
    }
  }, [groups, recalculating]);

  const routeOptions = useMemo((): RouteOption[] => {
    return groups.map((g) => ({
      containerId: routeContainerId(g.routeNum),
      label: g.routeNum != null ? `Route ${g.routeNum}` : "Overig",
    }));
  }, [groups]);

  const submitReorder = useCallback(
    async (nextContainers: Record<string, string[]>) => {
      const vertrektijden = loadRouteVertrektijden(defaultVertrektijd);
      const routes = Object.entries(nextContainers)
        .filter(([, ids]) => ids.length > 0)
        .map(([containerId, orderIds]) => {
          const routeNummer = parseContainerRoute(containerId);
          const rn = routeNummer ?? 1;
          return {
            routeNummer,
            orderIds,
            vertrektijd: vertrektijden[rn] ?? defaultVertrektijd,
          };
        });

      setRecalculating(true);
      setReorderError(null);
      try {
        const res = await fetch("/api/route/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routes }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            [data.error, data.detail].filter(Boolean).join(" — ") || "Herberekenen mislukt."
          );
        }
        setContainers(nextContainers);
        onReorderComplete?.((data.updates ?? []) as ReorderUpdate[]);
      } catch (e) {
        setContainers(groupsToContainers(groups));
        setReorderError(e instanceof Error ? e.message : "Herberekenen mislukt.");
      } finally {
        setRecalculating(false);
      }
    },
    [defaultVertrektijd, groups, onReorderComplete]
  );

  const applyReorder = useCallback(
    async (next: Record<string, string[]> | null) => {
      if (!next) return;
      const before = groupsToContainers(groups);
      if (JSON.stringify(before) === JSON.stringify(next)) return;
      setContainers(next);
      await submitReorder(next);
    },
    [groups, submitReorder]
  );

  const totalCount = Object.values(containers).reduce((n, ids) => n + ids.length, 0);
  const showRouteHeaders = groups.some((g) => g.routeNum != null);

  const containerEntries = useMemo(() => {
    return groups.map((g) => {
      const containerId = routeContainerId(g.routeNum);
      return {
        containerId,
        routeNum: g.routeNum,
        orderIds: containers[containerId] ?? [],
      };
    });
  }, [groups, containers]);

  return (
    <div className="space-y-2">
      {reorderEnabled && (
        <p className="text-xs text-stone-500">
          Gebruik <strong>↑ ↓</strong> voor volgorde en het <strong>Route-menu</strong> om een adres
          naar een andere bezorger te verplaatsen. Tijdsloten worden automatisch herberekend.
          {recalculating && (
            <span className="ml-2 font-medium text-koopje-orange">Bezig met herberekenen…</span>
          )}
        </p>
      )}
      {reorderError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{reorderError}</p>
      )}

      <div
        className={`overflow-x-auto rounded-xl border-2 border-stone-200 bg-white shadow-sm ${recalculating ? "pointer-events-none opacity-70" : ""}`}
      >
        <div className="min-w-max">
          <div
            className={`grid ${GRID_COLS} border-b border-stone-200 bg-stone-100 text-xs font-medium text-stone-700`}
          >
            {HEADERS.map((h) => (
              <div
                key={h}
                className={`border border-stone-200 px-2 py-2 ${h === "#" ? "text-center" : ""}`}
              >
                {h}
              </div>
            ))}
          </div>

          {totalCount === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-stone-400">
              Geen orders met meenemen = ja. Genereer eerst een route.
            </p>
          ) : (
            containerEntries.map(({ containerId, routeNum, orderIds }) => {
              const style = routeNum != null ? routeStyleForIndex(routeNum - 1) : null;
              return (
                <div key={containerId}>
                  {showRouteHeaders && routeNum != null && style && (
                    <div
                      className={`border border-stone-200 border-l-4 px-3 py-2 ${style.bg} ${style.border}`}
                    >
                      <span className={`text-sm font-semibold ${style.header}`}>{style.label}</span>
                      <span className="ml-2 text-xs text-stone-500">
                        ({orderIds.length} order{orderIds.length === 1 ? "" : "s"})
                      </span>
                    </div>
                  )}
                  {showRouteHeaders && routeNum == null && orderIds.length > 0 && (
                    <div className="border border-stone-200 bg-stone-50 px-3 py-2">
                      <span className="text-sm font-semibold text-stone-600">Overig</span>
                      <span className="ml-2 text-xs font-normal text-stone-500">
                        ({orderIds.length} order{orderIds.length === 1 ? "" : "s"})
                      </span>
                    </div>
                  )}
                  {orderIds.map((orderId, i) => {
                    const order = orderById.get(orderId);
                    if (!order) return null;
                    return (
                      <OrderRow
                        key={orderId}
                        order={order}
                        rowNum={i + 1}
                        rowClassName={style?.bg}
                        reorderEnabled={reorderEnabled}
                        routeOptions={routeOptions}
                        currentContainerId={containerId}
                        busy={recalculating}
                        onPatch={onPatch}
                        canMoveUp={i > 0}
                        canMoveDown={i < orderIds.length - 1}
                        onMoveUp={() =>
                          applyReorder(moveWithinContainer(containers, orderId, "up"))
                        }
                        onMoveDown={() =>
                          applyReorder(moveWithinContainer(containers, orderId, "down"))
                        }
                        onChangeRoute={(targetId) =>
                          applyReorder(moveToContainer(containers, orderId, targetId))
                        }
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
