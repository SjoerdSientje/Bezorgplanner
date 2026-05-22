"use client";

import { useState, useRef } from "react";
import type { AlleRittenOrder } from "@/components/AlleRittenTabel";

function parseSlotMin(slot: string | null | undefined): number {
  const t = String(slot ?? "").split(" - ")[0].replace(".", ":").trim();
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h)) return 9999;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function EditableSlotCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        className="w-full rounded border border-koopje-orange px-1 py-0.5 text-sm font-medium focus:outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="bv. 10:00 - 12:00"
      />
    );
  }

  return (
    <button
      type="button"
      className="w-full text-left font-medium text-koopje-black hover:underline hover:decoration-dotted"
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Klik om tijdslot te bewerken"
    >
      {value || <span className="text-stone-300 text-xs font-normal">Klik om in te vullen</span>}
    </button>
  );
}

const HEADERS = ["Tijdslot", "Voorkeurstijd", "Adres", "Model / Product", "Opmerking klant"];

export default function LijstSjoerd({
  orders,
  onPatch,
}: {
  orders: AlleRittenOrder[];
  onPatch: (id: string, fields: Record<string, unknown>) => void;
}) {
  const filtered = [...orders]
    .filter((o) => o.meenemen_in_planning === true)
    .sort((a, b) =>
      parseSlotMin(a.aankomsttijd_slot as string) - parseSlotMin(b.aankomsttijd_slot as string)
    );

  return (
    <div className="overflow-x-auto rounded-xl border-2 border-stone-200 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead>
          <tr className="bg-stone-100">
            <th className="w-8 border border-stone-200 px-2 py-2 text-center text-xs font-medium text-stone-700">
              #
            </th>
            {HEADERS.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td
                colSpan={HEADERS.length + 1}
                className="border border-stone-200 px-3 py-4 text-center text-sm text-stone-400"
              >
                Geen orders met meenemen = ja. Genereer eerst een route.
              </td>
            </tr>
          ) : (
            filtered.map((order, i) => (
              <tr
                key={String(order.id)}
                className="border-b border-stone-100 last:border-0 even:bg-stone-50/50"
              >
                <td className="border border-stone-200 px-2 py-1.5 text-center text-xs text-stone-500">
                  {i + 1}
                </td>
                {/* Tijdslot (bewerkbaar) */}
                <td className="border border-stone-200 px-3 py-1.5 whitespace-nowrap min-w-[10rem]">
                  <EditableSlotCell
                    value={String(order.aankomsttijd_slot ?? "")}
                    onSave={(v) => onPatch(String(order.id), { aankomsttijd_slot: v || null })}
                  />
                </td>
                {/* Voorkeurstijd */}
                <td className="border border-stone-200 px-3 py-1.5 text-stone-500 whitespace-nowrap">
                  {String(order.bezorgtijd_voorkeur ?? "") || <span className="text-stone-300">—</span>}
                </td>
                {/* Adres */}
                <td className="border border-stone-200 px-3 py-1.5 text-stone-600 min-w-[14rem]">
                  {String(order.volledig_adres ?? "") || <span className="text-stone-300">—</span>}
                </td>
                {/* Model */}
                <td className="border border-stone-200 px-3 py-1.5 text-stone-600 min-w-[10rem]">
                  {String(order.producten ?? "") || <span className="text-stone-300">—</span>}
                </td>
                {/* Opmerking klant */}
                <td className="border border-stone-200 px-3 py-1.5 text-xs text-stone-500 min-w-[10rem] max-w-[18rem]">
                  <span className="block whitespace-pre-wrap break-words">
                    {String(order.opmerkingen_klant ?? "") || <span className="text-stone-300">—</span>}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
