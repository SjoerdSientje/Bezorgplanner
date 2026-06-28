"use client";

import { routeStyleForIndex } from "@/lib/route-colors";

export type RoutePickOrder = {
  id: string;
  naam: string;
  volledig_adres: string;
  bezorgtijd_voorkeur?: string | null;
  aankomsttijd_slot?: string | null;
};

type Props = {
  routeIndex: number;
  orders: RoutePickOrder[];
  selectedIds: string[];
  assignedElsewhere: Map<string, number>;
  onChange: (ids: string[]) => void;
  onClose: () => void;
};

export default function RouteOrderPicker({
  routeIndex,
  orders,
  selectedIds,
  assignedElsewhere,
  onChange,
  onClose,
}: Props) {
  const style = routeStyleForIndex(routeIndex);
  const selected = new Set(selectedIds);

  function toggle(id: string) {
    if (assignedElsewhere.has(id) && assignedElsewhere.get(id) !== routeIndex) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  function selectAllAvailable() {
    const ids = orders
      .filter((o) => !assignedElsewhere.has(o.id) || assignedElsewhere.get(o.id) === routeIndex)
      .map((o) => o.id);
    onChange(ids);
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-koopje-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
          className={`flex max-h-[85dvh] w-full max-w-lg flex-col rounded-2xl border-l-4 bg-white shadow-xl ${style.border}`}
        >
          <div className={`border-b border-stone-100 px-5 py-4 ${style.bg}`}>
            <h3 className={`text-base font-semibold ${style.header}`}>
              {style.label} — kies adressen
            </h3>
            <p className="mt-1 text-xs text-stone-600">
              Selecteer orders uit Lijst Sjoerd voor deze bezorger ({selectedIds.length}{" "}
              geselecteerd).
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            {orders.length === 0 ? (
              <p className="text-sm text-stone-500">
                Geen orders in Lijst Sjoerd (meenemen = ja).
              </p>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={selectAllAvailable}
                  className="text-xs font-medium text-koopje-orange hover:underline"
                >
                  Alle beschikbare selecteren
                </button>
                {orders.map((order) => {
                  const otherRoute = assignedElsewhere.get(order.id);
                  const disabled = otherRoute != null && otherRoute !== routeIndex;
                  const checked = selected.has(order.id);
                  return (
                    <label
                      key={order.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                        disabled
                          ? "cursor-not-allowed border-stone-100 bg-stone-50 opacity-60"
                          : checked
                            ? `border-koopje-orange ${style.bg}`
                            : "border-stone-200 hover:border-stone-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(order.id)}
                        className="mt-0.5 h-4 w-4 accent-koopje-orange"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-koopje-black">
                            {order.naam || "Onbekend"}
                          </span>
                          {disabled && otherRoute != null && (
                            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-600">
                              Route {otherRoute + 1}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-stone-600">{order.volledig_adres}</p>
                        {(order.bezorgtijd_voorkeur || order.aankomsttijd_slot) && (
                          <p className="mt-0.5 text-xs text-stone-400">
                            {order.aankomsttijd_slot && (
                              <span>Tijdslot: {order.aankomsttijd_slot}</span>
                            )}
                            {order.bezorgtijd_voorkeur && (
                              <span>
                                {order.aankomsttijd_slot ? " · " : ""}
                                Voorkeur: {order.bezorgtijd_voorkeur}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-koopje-orange px-4 py-2 text-sm font-medium text-white"
            >
              Klaar ({selectedIds.length})
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
