"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import ProductenCell from "@/components/ProductenCell";
import OpmerkingKlantCell from "@/components/OpmerkingKlantCell";
import type { AlleRittenOrder } from "@/components/AlleRittenTabel";
import { compareOrdersOnRoute } from "@/lib/ritjes-mapping";
import { isOrderReadyForSjoerdLijst } from "@/lib/planning-date";
import { routeStyleForIndex, routeDisplayLabel, routeNaamFromOrders } from "@/lib/route-colors";
import { getVertrektijdForRoute, readSavedRoutesFromStorage } from "@/lib/route-vertrektijden";
import { DEPOT_RELOAD_MINUTES, orderRouteLoad, type OrderForRoute } from "@/lib/routific-payload";
import {
  isDepotStopId,
  makeDepotStopId,
  orderIdsFromStopSequence,
  stopSequenceFromOrderLegs,
} from "@/lib/depot-stops";

const DEPOT_ADDRESS_SHORT = "Kapelweg 2, De Bilt";

/** Totaal aantal load-eenheden voor een lijst stops (depot-IDs tellen niet). */
function totalLoadForOrders(
  stopIds: string[],
  orderById: Map<string, AlleRittenOrder>
): number {
  return orderIdsFromStopSequence(stopIds).reduce((sum, id) => {
    const o = orderById.get(id);
    if (!o) return sum;
    return sum + orderRouteLoad(o as unknown as OrderForRoute);
  }, 0);
}

function nextDepotStopId(stopIds: string[], routeKey: string | number | null): string {
  let max = 0;
  for (const id of stopIds) {
    if (!isDepotStopId(id)) continue;
    const m = String(id).match(/:(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return makeDepotStopId(routeKey, max + 1);
}

/** Visueel order-nummer (#) — depot-rijen tellen niet mee. */
function orderRowNumber(stopIds: string[], index: number): number {
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (!isDepotStopId(stopIds[i]!)) n += 1;
  }
  return n;
}

function depotPartAfter(stopIds: string[], depotIndex: number): number {
  let depots = 0;
  for (let i = 0; i <= depotIndex; i++) {
    if (isDepotStopId(stopIds[i]!)) depots += 1;
  }
  return depots + 1;
}

const GRID_COLS =
  "grid-cols-[2.5rem_minmax(9rem,1fr)_minmax(7rem,0.8fr)_minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]";

/** Extra kolommen op touch/mobiel: pijltjes + route-dropdown i.p.v. slepen. */
const GRID_COLS_TOUCH =
  "grid-cols-[2.75rem_minmax(5.5rem,6.5rem)_2rem_minmax(9rem,1fr)_minmax(7rem,0.8fr)_minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]";

const HEADERS_TOUCH = [
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

function useTouchReorder(): boolean {
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const coarse = window.matchMedia("(hover: none) and (pointer: coarse)");
    const narrow = window.matchMedia("(max-width: 768px)");
    const update = () => setTouch(coarse.matches || narrow.matches);
    update();
    coarse.addEventListener("change", update);
    narrow.addEventListener("change", update);
    return () => {
      coarse.removeEventListener("change", update);
      narrow.removeEventListener("change", update);
    };
  }, []);

  return touch;
}

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

function stopDragPointer(e: React.PointerEvent) {
  e.stopPropagation();
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

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

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
        onPointerDown={stopDragPointer}
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
      onPointerDown={stopDragPointer}
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

function DraggableAddress({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        className="w-full rounded border border-koopje-orange px-1 py-0.5 text-sm focus:outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== value) onSave(draft.trim());
        }}
        onPointerDown={stopDragPointer}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (draft.trim() !== value) onSave(draft.trim());
          }
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(value);
          }
        }}
      />
    );
  }

  return (
    <span
      className="block cursor-grab touch-manipulation text-sm text-stone-700 active:cursor-grabbing"
      title="Vasthouden en slepen om te verplaatsen · dubbelklik om te bewerken"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || <span className="text-stone-300 text-xs">—</span>}
    </span>
  );
}

const HEADERS = ["Tijdslot", "Voorkeurstijd", "Adres", "Model / Product", "Opmerking klant", "Email"];

type RouteGroup = {
  routeNum: number | null;
  orders: AlleRittenOrder[];
};

function sortRouteOrders(orders: AlleRittenOrder[]): AlleRittenOrder[] {
  return [...orders].sort((a, b) => compareOrdersOnRoute(a, b));
}

function orderLegNummer(order: AlleRittenOrder | undefined): number {
  const n = Number(order?.leg_nummer ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Capaciteit voor depot-delen: uit Route genereren, of afgeleid uit bestaande legs.
 * Werkt ook bij één bus zonder route_nummer (routeNum null → settings van route 1).
 */
function depotCapacityForRoute(
  routeNum: number | null,
  orderIds: string[],
  orderById: Map<string, AlleRittenOrder>
): number | null {
  if (orderIds.length === 0) return null;
  const savedIdx = routeNum != null && routeNum > 0 ? routeNum - 1 : 0;
  const saved = readSavedRoutesFromStorage()[savedIdx];
  const hadMulti = orderIds.some((id) => orderLegNummer(orderById.get(id)) > 1);
  if (!saved?.meerdereRitten && !hadMulti) return null;

  const clientCap =
    saved?.maxFietsen != null && Number.isFinite(saved.maxFietsen) && saved.maxFietsen >= 1
      ? Math.floor(saved.maxFietsen)
      : null;

  const loadByLeg = new Map<number, number>();
  for (const id of orderIds) {
    const o = orderById.get(id);
    if (!o) continue;
    const leg = orderLegNummer(o);
    loadByLeg.set(leg, (loadByLeg.get(leg) ?? 0) + orderRouteLoad(o as unknown as OrderForRoute));
  }
  const inferred =
    loadByLeg.size > 1 ? Math.max(...Array.from(loadByLeg.values())) : undefined;

  let capacity = clientCap ?? inferred ?? null;
  if (capacity == null || capacity < 1) return null;

  if (hadMulti && inferred != null) {
    const total = totalLoadForOrders(orderIds, orderById);
    const legsWithCap = Math.max(1, Math.ceil(total / capacity));
    const prevLegs = Math.max(1, ...orderIds.map((id) => orderLegNummer(orderById.get(id))));
    if (legsWithCap < prevLegs) capacity = inferred;
  }
  return capacity;
}

function DepotRowContent({
  legNummer,
  dragHandleProps,
  onRemove,
}: {
  legNummer: number;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
  onRemove?: () => void;
}) {
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="sticky left-0 z-[1] flex w-max max-w-[min(100vw,48rem)] items-center gap-3 px-3 py-2.5 text-sm text-amber-950">
        {dragHandleProps && (
          <span
            className="cursor-grab text-amber-700/70 active:cursor-grabbing"
            aria-hidden
            {...dragHandleProps}
          >
            ⠿
          </span>
        )}
        <div>
          <span className="font-semibold">Terug naar depot</span>
          <span className="text-amber-800">
            {" "}
            · {DEPOT_ADDRESS_SHORT} · herladen {DEPOT_RELOAD_MINUTES} min · daarna deel{" "}
            {legNummer}
          </span>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="ml-1 rounded border border-amber-300 bg-white/80 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
          >
            Verwijderen
          </button>
        )}
      </div>
    </div>
  );
}

function SortableDepotRow({
  id,
  legNummer,
  dragEnabled,
  onRemove,
}: {
  id: string;
  legNummer: number;
  dragEnabled: boolean;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !dragEnabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <DepotRowContent
        legNummer={legNummer}
        dragHandleProps={dragEnabled ? { ...attributes, ...listeners } : undefined}
        onRemove={onRemove}
      />
    </div>
  );
}

function groupByRoute(orders: AlleRittenOrder[]): RouteGroup[] {
  const filtered = orders.filter((o) => isOrderReadyForSjoerdLijst(o));
  const hasRoutes = filtered.some((o) => Number(o.route_nummer ?? 0) > 0);

  if (!hasRoutes) {
    return [{ routeNum: null, orders: sortRouteOrders(filtered) }];
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
      orders: sortRouteOrders(routeOrders),
    }));

  if (loose.length > 0) {
    groups.push({ routeNum: null, orders: sortRouteOrders(loose) });
  }

  return groups;
}

function groupsToContainers(groups: RouteGroup[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of groups) {
    const orderIds = g.orders.map((o) => String(o.id));
    out[routeContainerId(g.routeNum)] = stopSequenceFromOrderLegs(
      orderIds,
      (id) => {
        const o = g.orders.find((x) => String(x.id) === id);
        return orderLegNummer(o);
      },
      g.routeNum
    );
  }
  return out;
}

/** Routes waar de stopvolgorde (of inhoud) is gewijzigd. */
function containerIdsWithChangedOrder(
  prev: Record<string, string[]>,
  next: Record<string, string[]>
): Set<string> {
  const changed = new Set<string>();
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
  for (const key of keys) {
    if (JSON.stringify(prev[key] ?? []) !== JSON.stringify(next[key] ?? [])) {
      changed.add(key);
    }
  }
  return changed;
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
  rit_nummer: number;
  aankomsttijd_slot: string;
  leg_nummer?: number | null;
};

function SortableOrderRow({
  id,
  order,
  rowNum,
  rowClassName,
  dragEnabled,
  onPatch,
}: {
  id: string;
  order: AlleRittenOrder;
  rowNum: number;
  rowClassName?: string;
  dragEnabled: boolean;
  onPatch: (id: string, fields: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !dragEnabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid ${GRID_COLS} border-b border-stone-100 last:border-0 ${
        rowClassName ?? "bg-white even:bg-stone-50/50"
      } ${dragEnabled ? "cursor-grab touch-manipulation active:cursor-grabbing hover:shadow-sm" : ""} ${
        isDragging ? "shadow-md ring-2 ring-koopje-orange/40" : ""
      }`}
      {...(dragEnabled ? { ...attributes, ...listeners } : {})}
    >
      <div className="flex items-center justify-center border border-stone-200 px-1 py-2 text-xs text-stone-500">
        {rowNum}
      </div>

      <div className="border border-stone-200 px-3 py-2" onPointerDown={stopDragPointer}>
        <EditableCell
          value={String(order.aankomsttijd_slot ?? "")}
          onSave={(v) => onPatch(String(order.id), { aankomsttijd_slot: v || null })}
          placeholder="Klik om in te vullen"
          fontMedium
        />
      </div>

      <div className="border border-stone-200 px-3 py-2" onPointerDown={stopDragPointer}>
        <EditableCell
          value={String(order.bezorgtijd_voorkeur ?? "")}
          onSave={(v) => onPatch(String(order.id), { bezorgtijd_voorkeur: v || null })}
          placeholder="—"
        />
      </div>

      <div className="border border-stone-200 px-3 py-2 min-w-0">
        {dragEnabled ? (
          <DraggableAddress
            value={String(order.volledig_adres ?? "")}
            onSave={(v) => onPatch(String(order.id), { volledig_adres: v || null })}
          />
        ) : (
          <EditableCell
            value={String(order.volledig_adres ?? "")}
            onSave={(v) => onPatch(String(order.id), { volledig_adres: v || null })}
            placeholder="—"
          />
        )}
      </div>

      <div className="border border-stone-200 p-0 min-w-0" onPointerDown={stopDragPointer}>
        <ProductenCell
          value={String(order.producten ?? "")}
          lineItemsJson={(order.line_items_json as string | null | undefined) ?? null}
          bestellingTotaalPrijs={
            typeof order.bestelling_totaal_prijs === "number" ? order.bestelling_totaal_prijs : null
          }
          onSaveMulti={async (fields) => onPatch(String(order.id), fields)}
        />
      </div>

      <div className="border border-stone-200 p-0 min-w-0" onPointerDown={stopDragPointer}>
        <OpmerkingKlantCell
          value={String(order.opmerkingen_klant ?? "")}
          onSave={async (v) => onPatch(String(order.id), { opmerkingen_klant: v.trim() || null })}
        />
      </div>

      <div className="border border-stone-200 px-3 py-2 min-w-0" onPointerDown={stopDragPointer}>
        <EditableCell
          value={String(order.email ?? "")}
          onSave={(v) => onPatch(String(order.id), { email: v || null })}
          placeholder="—"
        />
      </div>
    </div>
  );
}

type RouteOption = { containerId: string; label: string };

function TouchOrderRow({
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
      className={`grid ${GRID_COLS_TOUCH} border-b border-stone-100 last:border-0 ${
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
              className="flex h-8 w-8 touch-manipulation items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-koopje-orange active:bg-stone-200 disabled:opacity-25"
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
              className="flex h-8 w-8 touch-manipulation items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-koopje-orange active:bg-stone-200 disabled:opacity-25"
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
            className="w-full min-w-0 rounded border border-stone-200 bg-white px-1 py-1.5 text-xs text-koopje-black focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
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

function DroppableRouteHeader({
  containerId,
  className,
  children,
}: {
  containerId: string;
  className: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: containerId });
  return (
    <div
      ref={setNodeRef}
      className={`border border-stone-200 px-3 py-2 ${className} ${
        isOver ? "ring-2 ring-inset ring-koopje-orange/60" : ""
      }`}
    >
      {children}
    </div>
  );
}

export default function LijstSjoerd({
  orders,
  onPatch,
  onReorderComplete,
}: {
  orders: AlleRittenOrder[];
  onPatch: (id: string, fields: Record<string, unknown>) => void;
  onReorderComplete?: (updates: ReorderUpdate[]) => void | Promise<void>;
}) {
  const groups = useMemo(() => groupByRoute(orders), [orders]);
  const orderById = useMemo(
    () => new Map(orders.map((o) => [String(o.id), o])),
    [orders]
  );

  const sjoerdCount = orders.filter((o) => isOrderReadyForSjoerdLijst(o)).length;
  const hasSlots = orders.some(
    (o) => isOrderReadyForSjoerdLijst(o) && String(o.aankomsttijd_slot ?? "").trim() !== ""
  );
  const touchReorder = useTouchReorder();
  const reorderEnabled = hasSlots && sjoerdCount >= 1;

  const [containers, setContainers] = useState<Record<string, string[]>>(() =>
    groupsToContainers(groups)
  );
  const containersRef = useRef(containers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [capacityWarning, setCapacityWarning] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const containersAtDragStartRef = useRef<Record<string, string[]> | null>(null);

  const dragEnabled = reorderEnabled && !touchReorder && !recalculating;
  const buttonReorderEnabled = reorderEnabled && touchReorder && !recalculating;

  useEffect(() => {
    containersRef.current = containers;
  }, [containers]);

  // Let op: NIET gaten op `recalculating` — die is nog steeds true tijdens de
  // fetchRitjes()-refetch die na een succesvolle herschikking loopt (submitReorder await't
  // onReorderComplete vóórdat de finally recalculating weer op false zet). Met die gate zou
  // deze effect de resync na élke geslaagde herschikking overslaan, waardoor `containers`
  // permanent blijft hangen op de oude, vóór-de-fetch berekende stand: bij de volgende
  // sleep-actie kloppen container-IDs dan niet meer met de verse `orders`/`groups`, waardoor
  // slepen stopt te werken en tijdsloten (voor orders die niet meer in de stale containers
  // staan) niet meer getoond worden.
  useEffect(() => {
    if (isDraggingRef.current) return;
    setContainers(groupsToContainers(groups));
  }, [groups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const submitReorder = useCallback(
    async (
      nextContainers: Record<string, string[]>,
      prevContainers: Record<string, string[]>
    ) => {
      const changedContainerIds = containerIdsWithChangedOrder(prevContainers, nextContainers);
      if (changedContainerIds.size === 0) return;

      const routeEntries = Object.entries(nextContainers)
        .filter(([containerId, ids]) => ids.length > 0 && changedContainerIds.has(containerId))
        .map(([containerId, stopIds]) => {
          const routeNummer = parseContainerRoute(containerId);
          const rn = routeNummer ?? 1;
          return {
            routeNummer,
            rn,
            stopIds,
            orderIds: orderIdsFromStopSequence(stopIds),
            previousOrderIds: orderIdsFromStopSequence(prevContainers[containerId] ?? []),
          };
        })
        .sort((a, b) => {
          const na = a.routeNummer ?? 9999;
          const nb = b.routeNummer ?? 9999;
          return na - nb;
        });

      if (routeEntries.length === 0) return;

      const routes = [];
      for (const entry of routeEntries) {
        if (entry.orderIds.length === 0) continue;
        // Overig (routeNummer null): herberekent via Google Maps in de nieuwe volgorde.
        // Vertrektijd = altijd die uit Route genereren (route 1). Niet ankeren op bestaande
        // tijdsloten: als een lange route over middernacht heen is gewikkeld (bijv. 00:45),
        // werd dat verkeerdelijk als vertrektijd gebruikt en startte de hele lijst 's nachts.
        if (entry.routeNummer == null) {
          const vertrektijd = getVertrektijdForRoute(1) ?? "";
          const orderByIdLocal = new Map(
            groups.flatMap((g) => g.orders).map((o) => [String(o.id), o])
          );
          const hadDepotLegs =
            entry.stopIds.some(isDepotStopId) ||
            entry.orderIds.some((id) => orderLegNummer(orderByIdLocal.get(id)) > 1);
          const saved = readSavedRoutesFromStorage()[0];
          const capFromOrders = depotCapacityForRoute(null, entry.orderIds, orderByIdLocal);
          routes.push({
            routeNummer: null,
            stopIds: entry.stopIds,
            orderIds: entry.orderIds,
            previousOrderIds: entry.previousOrderIds,
            vertrektijd,
            maxFietsen: saved?.maxFietsen ?? capFromOrders ?? undefined,
            meerdereRitten: Boolean(saved?.meerdereRitten) || hadDepotLegs,
          });
          continue;
        }
        const vertrektijd = getVertrektijdForRoute(entry.rn);
        if (!vertrektijd) {
          setReorderError(
            `Geen vertrektijd voor route ${entry.rn}. Stel deze in via Route genereren en bereken de route opnieuw.`
          );
          return;
        }
        const saved = readSavedRoutesFromStorage()[entry.rn - 1];
        const orderByIdLocal = new Map(
          groups.flatMap((g) => g.orders).map((o) => [String(o.id), o])
        );
        const hadDepotLegs =
          entry.stopIds.some(isDepotStopId) ||
          entry.orderIds.some((id) => orderLegNummer(orderByIdLocal.get(id)) > 1);
        const capFromOrders = depotCapacityForRoute(
          entry.routeNummer,
          entry.orderIds,
          orderByIdLocal
        );
        routes.push({
          routeNummer: entry.routeNummer,
          stopIds: entry.stopIds,
          orderIds: entry.orderIds,
          previousOrderIds: entry.previousOrderIds,
          vertrektijd,
          maxFietsen: saved?.maxFietsen ?? capFromOrders ?? undefined,
          meerdereRitten: Boolean(saved?.meerdereRitten) || hadDepotLegs,
        });
      }

      if (routes.length === 0) return;

      setRecalculating(true);
      setReorderError(null);
      setCapacityWarning(null);
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
        containersRef.current = nextContainers;
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setCapacityWarning(data.warnings.join(" "));
        }
        const updates = (data.updates ?? []) as ReorderUpdate[];
        await Promise.resolve(onReorderComplete?.(updates));
      } catch (e) {
        setContainers(groupsToContainers(groups));
        containersRef.current = groupsToContainers(groups);
        setReorderError(e instanceof Error ? e.message : "Herberekenen mislukt.");
      } finally {
        setRecalculating(false);
      }
    },
    [groups, onReorderComplete]
  );

  const routeOptions = useMemo((): RouteOption[] => {
    return groups.map((g) => {
      const naam =
        g.routeNum != null ? routeNaamFromOrders(g.orders) : null;
      return {
        containerId: routeContainerId(g.routeNum),
        label:
          g.routeNum != null
            ? routeDisplayLabel(g.routeNum, naam)
            : "Overig",
      };
    });
  }, [groups]);

  const applyReorder = useCallback(
    async (
      next: Record<string, string[]> | null,
      prevContainers?: Record<string, string[]>
    ) => {
      if (!next) return;
      const before = prevContainers ?? containersRef.current;
      if (JSON.stringify(before) === JSON.stringify(next)) return;
      setContainers(next);
      containersRef.current = next;
      await submitReorder(next, before);
    },
    [submitReorder]
  );

  const handleDragStart = (event: DragStartEvent) => {
    isDraggingRef.current = true;
    containersAtDragStartRef.current = {
      ...Object.fromEntries(
        Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
      ),
    };
    setActiveId(String(event.active.id));
    setReorderError(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    setContainers((prev) => {
      const activeContainer = findContainer(String(active.id), prev);
      const overContainer =
        findContainer(String(over.id), prev) ??
        (String(over.id) in prev ? String(over.id) : null);

      if (!activeContainer || !overContainer || activeContainer === overContainer) return prev;

      const activeItems = [...(prev[activeContainer] ?? [])];
      const overItems = [...(prev[overContainer] ?? [])];
      const activeIndex = activeItems.indexOf(String(active.id));
      if (activeIndex < 0) return prev;

      const overIndex = overItems.indexOf(String(over.id));
      const newIndex =
        String(over.id) in prev
          ? overItems.length
          : overIndex >= 0
            ? overIndex
            : overItems.length;

      const next = {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== String(active.id)),
        [overContainer]: [
          ...overItems.slice(0, newIndex),
          String(active.id),
          ...overItems.slice(newIndex),
        ],
      };
      containersRef.current = next;
      return next;
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    isDraggingRef.current = false;
    setActiveId(null);

    const { active, over } = event;
    if (!over) {
      setContainers(groupsToContainers(groups));
      return;
    }

    let nextContainers = { ...containersRef.current };
    const activeContainer = findContainer(String(active.id), nextContainers);
    const overContainer =
      findContainer(String(over.id), nextContainers) ??
      (String(over.id) in nextContainers ? String(over.id) : null);

    if (!activeContainer || !overContainer) return;

    if (activeContainer === overContainer) {
      const items = nextContainers[activeContainer] ?? [];
      const oldIndex = items.indexOf(String(active.id));
      const newIndex = items.indexOf(String(over.id));
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        nextContainers = {
          ...nextContainers,
          [activeContainer]: arrayMove(items, oldIndex, newIndex),
        };
        setContainers(nextContainers);
        containersRef.current = nextContainers;
      }
    }

    const prevContainers =
      containersAtDragStartRef.current ?? groupsToContainers(groups);
    containersAtDragStartRef.current = null;

    if (JSON.stringify(prevContainers) !== JSON.stringify(nextContainers)) {
      await submitReorder(nextContainers, prevContainers);
    }
  };

  const handleDragCancel = () => {
    isDraggingRef.current = false;
    containersAtDragStartRef.current = null;
    setActiveId(null);
    setContainers(groupsToContainers(groups));
  };

  const addDepotToContainer = useCallback(
    async (containerId: string, routeNum: number | null) => {
      const prev = {
        ...Object.fromEntries(
          Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
        ),
      };
      const items = [...(containersRef.current[containerId] ?? [])];
      if (orderIdsFromStopSequence(items).length < 2) {
        setReorderError("Minstens twee orders nodig om een depot-retour tussen te zetten.");
        return;
      }
      const depotId = nextDepotStopId(items, routeNum);
      const insertAt = Math.max(1, Math.floor(items.length / 2));
      items.splice(insertAt, 0, depotId);
      const next = { ...containersRef.current, [containerId]: items };
      setContainers(next);
      containersRef.current = next;
      await submitReorder(next, prev);
    },
    [submitReorder]
  );

  const removeDepotFromContainer = useCallback(
    async (containerId: string, depotId: string) => {
      const prev = {
        ...Object.fromEntries(
          Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
        ),
      };
      const items = (containersRef.current[containerId] ?? []).filter((id) => id !== depotId);
      const next = { ...containersRef.current, [containerId]: items };
      setContainers(next);
      containersRef.current = next;
      await submitReorder(next, prev);
    },
    [submitReorder]
  );

  const totalCount = Object.values(containers).reduce(
    (n, ids) => n + orderIdsFromStopSequence(ids).length,
    0
  );
  const showRouteHeaders = groups.some((g) => g.routeNum != null);

  const containerEntries = useMemo(() => {
    const entries: { containerId: string; routeNum: number | null; orderIds: string[] }[] = [];
    for (const g of groups) {
      const containerId = routeContainerId(g.routeNum);
      entries.push({
        containerId,
        routeNum: g.routeNum,
        orderIds: containers[containerId] ?? [],
      });
    }
    return entries;
  }, [groups, containers]);

  const activeOrder = activeId ? orderById.get(activeId) : null;

  const dragListInner = (
    <div className="min-w-max">
      <div
        className={`grid ${GRID_COLS} border-b border-stone-200 bg-stone-100 text-xs font-medium text-stone-700`}
      >
        <div className="border border-stone-200 px-1 py-2 text-center">#</div>
        {HEADERS.map((h) => (
          <div key={h} className="whitespace-nowrap border border-stone-200 px-3 py-2">
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
            <RouteGroupRows
              key={containerId}
              containerId={containerId}
              routeNum={routeNum}
              stopIds={orderIds}
              style={style}
              showRouteHeader={showRouteHeaders}
              orderById={orderById}
              dragEnabled={dragEnabled}
              canEditDepot={reorderEnabled && !recalculating}
              onPatch={onPatch}
              onAddDepot={() => addDepotToContainer(containerId, routeNum)}
              onRemoveDepot={(depotId) => removeDepotFromContainer(containerId, depotId)}
            />
          );
        })
      )}
    </div>
  );

  const touchListInner = (
    <div className="min-w-max">
      <div
        className={`grid ${GRID_COLS_TOUCH} border-b border-stone-200 bg-stone-100 text-xs font-medium text-stone-700`}
      >
        {HEADERS_TOUCH.map((h) => (
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
        containerEntries.map(({ containerId, routeNum, orderIds: stopIds }) => {
          const style = routeNum != null ? routeStyleForIndex(routeNum - 1) : null;
          const orderOnly = orderIdsFromStopSequence(stopIds);
          const routeOrders = orderOnly
            .map((id) => orderById.get(id))
            .filter((o): o is AlleRittenOrder => Boolean(o));
          const headerLabel =
            routeNum != null
              ? routeDisplayLabel(routeNum, routeNaamFromOrders(routeOrders))
              : "Overig";
          return (
            <div key={containerId}>
              {showRouteHeaders && routeNum != null && style && (
                <div
                  className={`border border-stone-200 border-l-4 px-3 py-2 ${style.bg} ${style.border}`}
                >
                  <span className={`text-sm font-semibold ${style.header}`}>{headerLabel}</span>
                  <span className="ml-2 text-xs text-stone-500">
                    ({orderOnly.length} order{orderOnly.length === 1 ? "" : "s"} ·{" "}
                    {totalLoadForOrders(stopIds, orderById)} load-eenh.)
                  </span>
                  {buttonReorderEnabled && (
                    <button
                      type="button"
                      onClick={() => addDepotToContainer(containerId, routeNum)}
                      className="ml-3 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                    >
                      + Depot
                    </button>
                  )}
                </div>
              )}
              {showRouteHeaders && routeNum == null && orderOnly.length > 0 && (
                <div className="border border-stone-200 bg-stone-50 px-3 py-2">
                  <span className="text-sm font-semibold text-stone-600">Overig</span>
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    ({orderOnly.length} order{orderOnly.length === 1 ? "" : "s"})
                  </span>
                  {buttonReorderEnabled && (
                    <button
                      type="button"
                      onClick={() => addDepotToContainer(containerId, routeNum)}
                      className="ml-3 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                    >
                      + Depot
                    </button>
                  )}
                </div>
              )}
              {stopIds.map((stopId, i) => {
                if (isDepotStopId(stopId)) {
                  return (
                    <div key={stopId}>
                      <DepotRowContent
                        legNummer={depotPartAfter(stopIds, i)}
                        onRemove={
                          buttonReorderEnabled
                            ? () => removeDepotFromContainer(containerId, stopId)
                            : undefined
                        }
                      />
                      {buttonReorderEnabled && (
                        <div className="flex gap-1 border-b border-amber-100 bg-amber-50/50 px-3 py-1">
                          <button
                            type="button"
                            disabled={i <= 0 || recalculating}
                            onClick={() => {
                              const prev = {
                                ...Object.fromEntries(
                                  Object.entries(containersRef.current).map(([k, v]) => [
                                    k,
                                    [...v],
                                  ])
                                ),
                              };
                              applyReorder(
                                moveWithinContainer(containersRef.current, stopId, "up"),
                                prev
                              );
                            }}
                            className="rounded border border-amber-300 px-2 py-0.5 text-xs disabled:opacity-40"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={i >= stopIds.length - 1 || recalculating}
                            onClick={() => {
                              const prev = {
                                ...Object.fromEntries(
                                  Object.entries(containersRef.current).map(([k, v]) => [
                                    k,
                                    [...v],
                                  ])
                                ),
                              };
                              applyReorder(
                                moveWithinContainer(containersRef.current, stopId, "down"),
                                prev
                              );
                            }}
                            className="rounded border border-amber-300 px-2 py-0.5 text-xs disabled:opacity-40"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
                const order = orderById.get(stopId);
                if (!order) return null;
                return (
                  <div
                    key={`${stopId}-${order.aankomsttijd_slot ?? ""}-${(order as { rit_nummer?: number }).rit_nummer ?? ""}`}
                  >
                    <TouchOrderRow
                      order={order}
                      rowNum={orderRowNumber(stopIds, i)}
                      rowClassName={style?.bg}
                      reorderEnabled={buttonReorderEnabled}
                      routeOptions={routeOptions}
                      currentContainerId={containerId}
                      busy={recalculating}
                      onPatch={onPatch}
                      canMoveUp={i > 0}
                      canMoveDown={i < stopIds.length - 1}
                      onMoveUp={() => {
                        const prev = {
                          ...Object.fromEntries(
                            Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
                          ),
                        };
                        applyReorder(
                          moveWithinContainer(containersRef.current, stopId, "up"),
                          prev
                        );
                      }}
                      onMoveDown={() => {
                        const prev = {
                          ...Object.fromEntries(
                            Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
                          ),
                        };
                        applyReorder(
                          moveWithinContainer(containersRef.current, stopId, "down"),
                          prev
                        );
                      }}
                      onChangeRoute={(targetId) => {
                        const prev = {
                          ...Object.fromEntries(
                            Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
                          ),
                        };
                        applyReorder(
                          moveToContainer(containersRef.current, stopId, targetId),
                          prev
                        );
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      {reorderEnabled && (
        <p className="text-xs text-stone-500">
          {touchReorder ? (
            <>
              Gebruik <strong>↑ ↓</strong> voor volgorde en het <strong>Route-menu</strong> om een
              adres naar een andere bezorger te verplaatsen. Tijdsloten worden herberekend via Google
              Maps.
            </>
          ) : (
            <>
              <strong>Vasthouden op een rij of adres</strong> en slepen om volgorde of route te
              wijzigen. Sleep ook de amber <strong>Terug naar depot</strong>-rij, of voeg er een toe
              via <strong>+ Depot</strong>. Tijdsloten via Google Maps.
            </>
          )}
          {recalculating && (
            <span className="ml-2 font-medium text-koopje-orange">Bezig met herberekenen…</span>
          )}
        </p>
      )}
      {reorderError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{reorderError}</p>
      )}
      {capacityWarning && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">{capacityWarning}</p>
      )}

      <div
        className={`overflow-x-auto rounded-xl border-2 border-stone-200 bg-white shadow-sm ${recalculating ? "pointer-events-none opacity-70" : ""}`}
      >
        {touchReorder ? (
          touchListInner
        ) : dragEnabled || reorderEnabled ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {dragListInner}
            <DragOverlay dropAnimation={null}>
              {activeOrder ? (
                <div className="max-w-sm rounded-lg border-2 border-koopje-orange bg-white px-4 py-3 text-sm shadow-xl">
                  <p className="font-semibold text-koopje-black">
                    {String(activeOrder.naam ?? "Order")}
                  </p>
                  <p className="mt-1 text-stone-600">{String(activeOrder.volledig_adres ?? "")}</p>
                  <p className="mt-1 text-xs text-stone-400">
                    {String(activeOrder.aankomsttijd_slot ?? "")}
                  </p>
                </div>
              ) : activeId && isDepotStopId(activeId) ? (
                <div className="max-w-sm rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm shadow-xl text-amber-950">
                  <p className="font-semibold">Terug naar depot</p>
                  <p className="mt-1">{DEPOT_ADDRESS_SHORT}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          dragListInner
        )}
      </div>
    </div>
  );
}

function RouteGroupRows({
  containerId,
  routeNum,
  stopIds,
  style,
  showRouteHeader,
  orderById,
  dragEnabled,
  canEditDepot,
  onPatch,
  onAddDepot,
  onRemoveDepot,
}: {
  containerId: string;
  routeNum: number | null;
  stopIds: string[];
  style: ReturnType<typeof routeStyleForIndex> | null;
  showRouteHeader: boolean;
  orderById: Map<string, AlleRittenOrder>;
  dragEnabled: boolean;
  canEditDepot: boolean;
  onPatch: (id: string, fields: Record<string, unknown>) => void;
  onAddDepot: () => void;
  onRemoveDepot: (depotId: string) => void;
}) {
  const orderOnly = orderIdsFromStopSequence(stopIds);
  const routeOrders = orderOnly
    .map((id) => orderById.get(id))
    .filter((o): o is AlleRittenOrder => Boolean(o));
  const headerLabel =
    routeNum != null
      ? routeDisplayLabel(routeNum, routeNaamFromOrders(routeOrders))
      : "Overig";

  return (
    <div>
      {showRouteHeader && routeNum != null && style && (
        <DroppableRouteHeader
          containerId={containerId}
          className={`${style.bg} border-l-4 ${style.border}`}
        >
          <span className={`text-sm font-semibold ${style.header}`}>{headerLabel}</span>
          <span className="ml-2 text-xs text-stone-500">
            ({orderOnly.length} order{orderOnly.length === 1 ? "" : "s"} ·{" "}
            {totalLoadForOrders(stopIds, orderById)} load-eenh.)
          </span>
          {canEditDepot && (
            <button
              type="button"
              onClick={onAddDepot}
              className="ml-3 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
            >
              + Depot
            </button>
          )}
        </DroppableRouteHeader>
      )}
      {showRouteHeader && routeNum == null && orderOnly.length > 0 && (
        <DroppableRouteHeader containerId={containerId} className="bg-stone-50">
          <span className="text-sm font-semibold text-stone-600">Overig</span>
          <span className="ml-2 text-xs font-normal text-stone-500">
            ({orderOnly.length} order{orderOnly.length === 1 ? "" : "s"})
          </span>
          {canEditDepot && (
            <button
              type="button"
              onClick={onAddDepot}
              className="ml-3 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
            >
              + Depot
            </button>
          )}
        </DroppableRouteHeader>
      )}
      {!showRouteHeader && canEditDepot && orderOnly.length >= 2 && (
        <div className="border-b border-stone-100 px-3 py-1.5">
          <button
            type="button"
            onClick={onAddDepot}
            className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
          >
            + Depot
          </button>
        </div>
      )}
      <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
        {stopIds.map((id, i) => {
          if (isDepotStopId(id)) {
            return (
              <SortableDepotRow
                key={id}
                id={id}
                legNummer={depotPartAfter(stopIds, i)}
                dragEnabled={dragEnabled}
                onRemove={canEditDepot ? () => onRemoveDepot(id) : undefined}
              />
            );
          }
          const order = orderById.get(id);
          if (!order) return null;
          return (
            <SortableOrderRow
              key={`${id}-${order.aankomsttijd_slot ?? ""}-${(order as { rit_nummer?: number }).rit_nummer ?? ""}`}
              id={id}
              order={order}
              rowNum={orderRowNumber(stopIds, i)}
              rowClassName={style?.bg}
              dragEnabled={dragEnabled}
              onPatch={onPatch}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}
