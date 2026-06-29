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
import { routeStyleForIndex } from "@/lib/route-colors";

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

function groupByRoute(orders: AlleRittenOrder[]): RouteGroup[] {
  const filtered = orders.filter((o) => o.meenemen_in_planning === true);
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
    out[routeContainerId(g.routeNum)] = g.orders.map((o) => String(o.id));
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
  defaultVertrektijd = "10:30",
}: {
  orders: AlleRittenOrder[];
  onPatch: (id: string, fields: Record<string, unknown>) => void;
  onReorderComplete?: (updates: ReorderUpdate[]) => void | Promise<void>;
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
  const touchReorder = useTouchReorder();
  const reorderEnabled = hasSlots && sjoerdCount >= 1;

  const [containers, setContainers] = useState<Record<string, string[]>>(() =>
    groupsToContainers(groups)
  );
  const containersRef = useRef(containers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const containersAtDragStartRef = useRef<Record<string, string[]> | null>(null);

  const dragEnabled = reorderEnabled && !touchReorder && !recalculating;
  const buttonReorderEnabled = reorderEnabled && touchReorder && !recalculating;

  useEffect(() => {
    containersRef.current = containers;
  }, [containers]);

  useEffect(() => {
    if (recalculating || isDraggingRef.current) return;
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

      const vertrektijden = loadRouteVertrektijden(defaultVertrektijd);
      const routes = Object.entries(nextContainers)
        .filter(([containerId, ids]) => ids.length > 0 && changedContainerIds.has(containerId))
        .map(([containerId, orderIds]) => {
          const routeNummer = parseContainerRoute(containerId);
          const rn = routeNummer ?? 1;
          return {
            routeNummer,
            orderIds,
            vertrektijd: vertrektijden[rn] ?? defaultVertrektijd,
          };
        })
        .sort((a, b) => {
          const na = a.routeNummer ?? 9999;
          const nb = b.routeNummer ?? 9999;
          return na - nb;
        });

      if (routes.length === 0) return;

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
        containersRef.current = nextContainers;
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
    [defaultVertrektijd, groups, onReorderComplete]
  );

  const routeOptions = useMemo((): RouteOption[] => {
    return groups.map((g) => ({
      containerId: routeContainerId(g.routeNum),
      label: g.routeNum != null ? `Route ${g.routeNum}` : "Overig",
    }));
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

  const totalCount = Object.values(containers).reduce((n, ids) => n + ids.length, 0);
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
              orderIds={orderIds}
              style={style}
              showRouteHeader={showRouteHeaders}
              orderById={orderById}
              dragEnabled={dragEnabled}
              onPatch={onPatch}
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
                  <TouchOrderRow
                    key={`${orderId}-${order.aankomsttijd_slot ?? ""}-${(order as { rit_nummer?: number }).rit_nummer ?? ""}`}
                    order={order}
                    rowNum={i + 1}
                    rowClassName={style?.bg}
                    reorderEnabled={buttonReorderEnabled}
                    routeOptions={routeOptions}
                    currentContainerId={containerId}
                    busy={recalculating}
                    onPatch={onPatch}
                    canMoveUp={i > 0}
                    canMoveDown={i < orderIds.length - 1}
                    onMoveUp={() => {
                      const prev = {
                        ...Object.fromEntries(
                          Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
                        ),
                      };
                      applyReorder(moveWithinContainer(containersRef.current, orderId, "up"), prev);
                    }}
                    onMoveDown={() => {
                      const prev = {
                        ...Object.fromEntries(
                          Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
                        ),
                      };
                      applyReorder(moveWithinContainer(containersRef.current, orderId, "down"), prev);
                    }}
                    onChangeRoute={(targetId) => {
                      const prev = {
                        ...Object.fromEntries(
                          Object.entries(containersRef.current).map(([k, v]) => [k, [...v]])
                        ),
                      };
                      applyReorder(moveToContainer(containersRef.current, orderId, targetId), prev);
                    }}
                  />
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
              wijzigen. Tijdsloten worden herberekend via Google Maps.
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
  orderIds,
  style,
  showRouteHeader,
  orderById,
  dragEnabled,
  onPatch,
}: {
  containerId: string;
  routeNum: number | null;
  orderIds: string[];
  style: ReturnType<typeof routeStyleForIndex> | null;
  showRouteHeader: boolean;
  orderById: Map<string, AlleRittenOrder>;
  dragEnabled: boolean;
  onPatch: (id: string, fields: Record<string, unknown>) => void;
}) {
  return (
    <div>
      {showRouteHeader && routeNum != null && style && (
        <DroppableRouteHeader
          containerId={containerId}
          className={`${style.bg} border-l-4 ${style.border}`}
        >
          <span className={`text-sm font-semibold ${style.header}`}>{style.label}</span>
          <span className="ml-2 text-xs text-stone-500">
            ({orderIds.length} order{orderIds.length === 1 ? "" : "s"})
          </span>
        </DroppableRouteHeader>
      )}
      {showRouteHeader && routeNum == null && orderIds.length > 0 && (
        <DroppableRouteHeader containerId={containerId} className="bg-stone-50">
          <span className="text-sm font-semibold text-stone-600">Overig</span>
          <span className="ml-2 text-xs font-normal text-stone-500">
            ({orderIds.length} order{orderIds.length === 1 ? "" : "s"})
          </span>
        </DroppableRouteHeader>
      )}
      <SortableContext items={orderIds} strategy={verticalListSortingStrategy}>
        {orderIds.map((id, i) => {
          const order = orderById.get(id);
          if (!order) return null;
          return (
            <SortableOrderRow
              key={`${id}-${order.aankomsttijd_slot ?? ""}-${(order as { rit_nummer?: number }).rit_nummer ?? ""}`}
              id={id}
              order={order}
              rowNum={i + 1}
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
