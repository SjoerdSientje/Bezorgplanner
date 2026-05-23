"use client";

import { useState, useCallback, useRef } from "react";
import ProductenCell from "@/components/ProductenCell";
import OpmerkingKlantCell from "@/components/OpmerkingKlantCell";

export type PlanningKleur = "groen" | "oranje" | "rood" | null;

export type AlleRittenOrder = {
  id: string;
  order_nummer?: string | number | null;
  naam?: string | null;
  datum_opmerking?: string | null;
  meenemen_in_planning?: boolean | null;
  producten?: string | null;
  line_items_json?: string | null;
  bestelling_totaal_prijs?: number | null;
  volledig_adres?: string | null;
  opmerkingen_klant?: string | null;
  telefoon_nummer?: string | null;
  telefoon_e164?: string | null;
  betaald?: boolean | null;
  bezorgtijd_voorkeur?: string | null;
  planning_kleur?: PlanningKleur;
  planning_opmerking?: string | null;
  aankomsttijd_slot?: string | null;
  [key: string]: unknown;
};

function extractWoonplaats(volledigAdres: string | null | undefined): string {
  const addr = String(volledigAdres ?? "").trim();
  if (!addr) return "";
  const match = addr.match(/\b\d{4}\s*[A-Za-z]{2}\b[,\s]+(.+)/);
  if (match) return String(match[1]).trim();
  const parts = addr.split(/[,\n]/);
  const last = parts[parts.length - 1]?.trim();
  return last || addr;
}

const KLEUR_CYCLE: PlanningKleur[] = [null, "groen", "oranje", "rood"];

function nextKleur(current: PlanningKleur): PlanningKleur {
  const idx = KLEUR_CYCLE.indexOf(current);
  return KLEUR_CYCLE[(idx + 1) % KLEUR_CYCLE.length] ?? null;
}

const KLEUR_DOT: Record<string, string> = {
  groen: "bg-green-500",
  oranje: "bg-orange-400",
  rood: "bg-red-500",
};

const KLEUR_ROW: Record<string, string> = {
  groen: "bg-green-50",
  oranje: "bg-orange-50",
  rood: "bg-red-50",
};

function KleurDot({ kleur, onClick }: { kleur: PlanningKleur; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={kleur ?? "geen markering"}
      className={`h-5 w-5 rounded-full border-2 transition hover:scale-110 ${
        kleur ? `${KLEUR_DOT[kleur]} border-transparent` : "border-stone-300 bg-white"
      }`}
    />
  );
}

function OpmerkingPopup({
  naam,
  opmerking,
  onSave,
  onClose,
}: {
  naam: string;
  opmerking: string;
  onSave: (v: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(opmerking);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-koopje-black">{naam}</h3>
        <p className="mb-3 text-sm text-orange-600">Planning opmerking (verplicht bij oranje)</p>
        <textarea
          autoFocus
          className="w-full rounded-xl border border-stone-200 p-3 text-sm focus:border-koopje-orange focus:outline-none"
          rows={4}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Voeg een opmerking toe…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={() => { onSave(val); onClose(); }}
            className="rounded-xl bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange/90"
          >
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyCell({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const phone = String(value ?? "").trim();
  if (!phone) return <span className="text-stone-300">—</span>;

  const handleCopy = () => {
    navigator.clipboard.writeText(phone).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="block w-full text-left text-sm text-koopje-orange underline underline-offset-2 hover:text-koopje-orange/80"
      title="Klik om te kopiëren"
    >
      {copied ? "✓ Gekopieerd" : phone}
    </button>
  );
}

export default function AlleRittenTabel({
  orders,
  onPatch,
  onDelete,
}: {
  orders: AlleRittenOrder[];
  onPatch: (id: string, fields: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [popup, setPopup] = useState<{ id: string; naam: string; opmerking: string } | null>(null);

  const handleKleurClick = useCallback(
    (order: AlleRittenOrder) => {
      const next = nextKleur((order.planning_kleur as PlanningKleur) ?? null);
      onPatch(order.id, { planning_kleur: next });
      if (next === "oranje") {
        setPopup({
          id: order.id,
          naam: String(order.naam ?? ""),
          opmerking: String(order.planning_opmerking ?? ""),
        });
      }
    },
    [onPatch]
  );

  const handleNaamClick = useCallback(
    (order: AlleRittenOrder) => {
      if ((order.planning_kleur as PlanningKleur) !== "oranje") return;
      setPopup({
        id: order.id,
        naam: String(order.naam ?? ""),
        opmerking: String(order.planning_opmerking ?? ""),
      });
    },
    []
  );

  const handleOpmerkingSave = useCallback(
    (id: string, val: string) => {
      onPatch(id, { planning_opmerking: val || null });
    },
    [onPatch]
  );

  const headers = [
    "", // kleur
    "Voorkeursdatum",
    "Meenemen?",
    "Naam",
    "Product(en)",
    "Woonplaats",
    "Opmerkingen klant",
    "Order nr.",
    "Bedrag",
    "Betaald?",
    "Telefoon",
    "", // delete
  ];

  if (orders.length === 0) {
    return <p className="text-sm text-stone-400">Geen ritjes.</p>;
  }

  return (
    <>
      {popup && (
        <OpmerkingPopup
          naam={popup.naam}
          opmerking={popup.opmerking}
          onSave={(v) => handleOpmerkingSave(popup.id, v)}
          onClose={() => setPopup(null)}
        />
      )}
      <div className="overflow-x-auto rounded-xl border-2 border-stone-200 bg-white shadow-sm">
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <thead>
            <tr className="bg-stone-100">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border border-stone-200 px-2 py-2 text-xs font-medium text-stone-700"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const kleur = (order.planning_kleur as PlanningKleur) ?? null;
              const rowBg = kleur ? KLEUR_ROW[kleur] : "";
              const isOranje = kleur === "oranje";
              const woonplaats = extractWoonplaats(order.volledig_adres as string);
              const telefoon = String(order.telefoon_e164 ?? order.telefoon_nummer ?? "").trim();
              const prijs = typeof order.bestelling_totaal_prijs === "number"
                ? `€ ${order.bestelling_totaal_prijs.toFixed(2)}`
                : "";

              return (
                <tr key={order.id} className={`border-b border-stone-100 last:border-0 ${rowBg}`}>
                  {/* Kleur */}
                  <td className="border border-stone-200 px-2 py-1.5 text-center">
                    <KleurDot kleur={kleur} onClick={() => handleKleurClick(order)} />
                  </td>

                  {/* Voorkeursdatum */}
                  <td className="border border-stone-200 px-2 py-1.5">
                    <EditableCell
                      value={String(order.datum_opmerking ?? "")}
                      onSave={(v) => onPatch(order.id, { datum_opmerking: v || null })}
                      placeholder="—"
                    />
                  </td>

                  {/* Meenemen */}
                  <td className="border border-stone-200 px-2 py-1.5 text-center">
                    <MeenemenToggle
                      value={order.meenemen_in_planning === true}
                      onChange={(v) => onPatch(order.id, { meenemen_in_planning: v })}
                    />
                  </td>

                  {/* Naam */}
                  <td className="border border-stone-200 px-2 py-1.5 min-w-[8rem]">
                    {isOranje ? (
                      <button
                        type="button"
                        onClick={() => handleNaamClick(order)}
                        className="w-full text-left font-medium text-orange-700 underline decoration-dotted underline-offset-2 hover:text-orange-900"
                        title={order.planning_opmerking ? String(order.planning_opmerking) : "Voeg opmerking toe"}
                      >
                        {String(order.naam ?? "—")}
                        {order.planning_opmerking && (
                          <span className="ml-1 text-xs text-orange-400">💬</span>
                        )}
                      </button>
                    ) : (
                      <span className="font-medium text-koopje-black">{String(order.naam ?? "—")}</span>
                    )}
                  </td>

                  {/* Producten */}
                  <td className="border border-stone-200 p-0 min-w-[10rem]">
                    <ProductenCell
                      value={String(order.producten ?? "")}
                      lineItemsJson={(order.line_items_json as string | null | undefined) ?? null}
                      bestellingTotaalPrijs={typeof order.bestelling_totaal_prijs === "number" ? order.bestelling_totaal_prijs : null}
                      onSaveMulti={async (fields) => {
                        onPatch(order.id, fields);
                      }}
                    />
                  </td>

                  {/* Woonplaats */}
                  <td className="border border-stone-200 px-2 py-1.5 text-stone-600 min-w-[7rem]">
                    {woonplaats || <span className="text-stone-300">—</span>}
                  </td>

                  {/* Opmerkingen klant */}
                  <td className="border border-stone-200 p-0 min-w-[10rem] max-w-[16rem]">
                    <OpmerkingKlantCell
                      value={String(order.opmerkingen_klant ?? "")}
                      onSave={async (v) => onPatch(order.id, { opmerkingen_klant: v.trim() || null })}
                    />
                  </td>

                  {/* Ordernummer */}
                  <td className="border border-stone-200 px-2 py-1.5 text-stone-500 whitespace-nowrap">
                    {String(order.order_nummer ?? "—")}
                  </td>

                  {/* Bedrag */}
                  <td className="border border-stone-200 px-2 py-1.5 text-stone-600 whitespace-nowrap">
                    {prijs || <span className="text-stone-300">—</span>}
                  </td>

                  {/* Betaald */}
                  <td className="border border-stone-200 px-2 py-1.5 text-center">
                    <MeenemenToggle
                      value={order.betaald === true}
                      onChange={(v) => onPatch(order.id, { betaald: v })}
                    />
                  </td>

                  {/* Telefoon (kopieer) */}
                  <td className="border border-stone-200 px-2 py-1.5 whitespace-nowrap min-w-[8rem]">
                    <CopyCell value={telefoon} />
                  </td>

                  {/* Delete */}
                  <td className="border border-stone-200 px-1 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => onDelete(order.id)}
                      className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-500 transition"
                      title="Verwijder order"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EditableCell({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        className="w-full rounded border border-koopje-orange px-1 py-0.5 text-sm focus:outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      />
    );
  }

  return (
    <button
      type="button"
      className="w-full text-left text-sm text-stone-600 hover:underline hover:decoration-dotted"
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {value || <span className="text-stone-300">{placeholder ?? "—"}</span>}
    </button>
  );
}

function MeenemenToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`rounded-lg px-2 py-0.5 text-xs font-medium transition ${
        value
          ? "bg-green-100 text-green-700 hover:bg-green-200"
          : "bg-stone-100 text-stone-500 hover:bg-stone-200"
      }`}
    >
      {value ? "ja" : "nee"}
    </button>
  );
}
