"use client";

import { useState } from "react";
import ProductenCell from "@/components/ProductenCell";
import OpmerkingKlantCell from "@/components/OpmerkingKlantCell";
import type { AlleRittenOrder } from "@/components/AlleRittenTabel";

function parseSlotMin(slot: string | null | undefined): number {
  const t = String(slot ?? "").split(" - ")[0].replace(".", ":").trim();
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h)) return 9999;
  return h * 60 + (Number.isFinite(m) ? m : 0);
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
          if (e.key === "Escape") { setEditing(false); setDraft(value); }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`w-full text-left text-sm hover:underline hover:decoration-dotted ${fontMedium ? "font-medium text-koopje-black" : "text-stone-600"}`}
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {value || <span className="text-stone-300 font-normal text-xs">{placeholder ?? "—"}</span>}
    </button>
  );
}

const HEADERS = ["Tijdslot", "Voorkeurstijd", "Adres", "Model / Product", "Opmerking klant", "Email"];

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

                {/* Tijdslot */}
                <td className="border border-stone-200 px-3 py-1.5 whitespace-nowrap min-w-[10rem]">
                  <EditableCell
                    value={String(order.aankomsttijd_slot ?? "")}
                    onSave={(v) => onPatch(String(order.id), { aankomsttijd_slot: v || null })}
                    placeholder="Klik om in te vullen"
                    fontMedium
                  />
                </td>

                {/* Voorkeurstijd */}
                <td className="border border-stone-200 px-3 py-1.5 whitespace-nowrap min-w-[8rem]">
                  <EditableCell
                    value={String(order.bezorgtijd_voorkeur ?? "")}
                    onSave={(v) => onPatch(String(order.id), { bezorgtijd_voorkeur: v || null })}
                    placeholder="—"
                  />
                </td>

                {/* Adres */}
                <td className="border border-stone-200 px-3 py-1.5 min-w-[14rem]">
                  <EditableCell
                    value={String(order.volledig_adres ?? "")}
                    onSave={(v) => onPatch(String(order.id), { volledig_adres: v || null })}
                    placeholder="—"
                  />
                </td>

                {/* Model / Product */}
                <td className="border border-stone-200 p-0 min-w-[10rem]">
                  <ProductenCell
                    value={String(order.producten ?? "")}
                    lineItemsJson={(order.line_items_json as string | null | undefined) ?? null}
                    bestellingTotaalPrijs={typeof order.bestelling_totaal_prijs === "number" ? order.bestelling_totaal_prijs : null}
                    onSaveMulti={async (fields) => onPatch(String(order.id), fields)}
                  />
                </td>

                {/* Opmerking klant */}
                <td className="border border-stone-200 p-0 min-w-[10rem] max-w-[18rem]">
                  <OpmerkingKlantCell
                    value={String(order.opmerkingen_klant ?? "")}
                    onSave={async (v) => onPatch(String(order.id), { opmerkingen_klant: v.trim() || null })}
                  />
                </td>

                {/* Email */}
                <td className="border border-stone-200 px-3 py-1.5 min-w-[12rem]">
                  <EditableCell
                    value={String(order.email ?? "")}
                    onSave={(v) => onPatch(String(order.id), { email: v || null })}
                    placeholder="—"
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
