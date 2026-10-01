"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import AdresAutocomplete from "@/components/AdresAutocomplete";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import {
  DEFAULT_PRODUCT_RULES_V2,
  getDefaultItemsForFiets,
  normalizeProductDefaultItemsRules,
  type ProductDefaultItemsRulesV2,
} from "@/lib/product-default-items-rules";
import { splitVolledigAdres } from "@/lib/adres-fields";
import {
  parseMpProductenFromLineItemsJson,
  type MpJaNee,
  type MpLevering,
  type MpProductType,
} from "@/lib/mp-order-products";

type OrderRow = {
  id: string;
  order_nummer: string | null;
  status: string;
  naam: string | null;
  email: string | null;
  telefoon_nummer: string | null;
  volledig_adres: string | null;
  bezorgtijd_voorkeur: string | null;
  datum_opmerking: string | null;
  opmerkingen_klant: string | null;
  producten: string | null;
  bestelling_totaal_prijs: number | null;
  line_items_json: string | null;
};

type ProductRegel = {
  id: number;
  type: MpProductType;
  naam: string;
  prijs: string;
  levering: MpLevering;
  montageOpmerking: string;
  achterzitje: MpJaNee;
  achterzitjeGemonteerd: MpJaNee;
  voorrekje: MpJaNee;
  voorrekjeGemonteerd: MpJaNee;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
};

type EditDraft = {
  id: string;
  order_nummer: string | null;
  naam: string;
  email: string;
  telefoonnummer: string;
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  bezorgtijd_voorkeur: string;
  datum_voorkeur: string;
  opmerking: string;
  producten: ProductRegel[];
};

let nextId = 1;
function mkId() {
  return nextId++;
}

function defaultProduct(): ProductRegel {
  return {
    id: mkId(),
    type: "fiets",
    naam: "",
    prijs: "",
    levering: "Volledig rijklaar",
    montageOpmerking: "",
    achterzitje: null,
    achterzitjeGemonteerd: null,
    voorrekje: null,
    voorrekjeGemonteerd: null,
    shopify_product_id: null,
    shopify_variant_id: null,
  };
}

function statusLabel(status: string) {
  if (status === "ritjes_vandaag") return "Ritjes vandaag";
  if (status === "gepland") return "Planning";
  return status;
}

function JaNeeKeuze({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MpJaNee;
  onChange: (v: MpJaNee) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-koopje-black">{label}</p>
      <div className="flex gap-2">
        {(["ja", "nee"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(value === opt ? null : opt)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              value === opt
                ? opt === "ja"
                  ? "border-green-500 bg-green-50 text-green-700"
                  : "border-stone-400 bg-stone-100 text-stone-600"
                : "border-stone-200 bg-white text-stone-500 hover:border-stone-300"
            }`}
          >
            {opt === "ja" ? "✓ Ja" : "✗ Nee"}
          </button>
        ))}
      </div>
    </div>
  );
}

function LeveringKeuze({
  value,
  onChange,
}: {
  value: MpLevering;
  onChange: (v: MpLevering) => void;
}) {
  return (
    <div className="flex gap-2">
      {(["Volledig rijklaar", "In doos"] as MpLevering[]).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            value === opt
              ? "border-koopje-orange bg-koopje-orange-light text-koopje-orange"
              : "border-stone-200 bg-white text-stone-500 hover:border-koopje-orange/40"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function StandaardProductenLijst({
  naam,
  levering,
  rules,
}: {
  naam: string;
  levering: MpLevering;
  rules: ProductDefaultItemsRulesV2;
}) {
  const trimmed = naam.trim();
  if (!trimmed) return null;
  const items = getDefaultItemsForFiets(
    trimmed,
    [{ name: "Levering", value: levering }],
    rules
  );
  if (items.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-dashed border-stone-200 bg-white/80 p-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
        Standaard inbegrepen bij deze fiets
      </p>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5 text-xs text-stone-600">
            <span className="text-[10px]">📦</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MarktplaatsGeplandClient() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [productRules, setProductRules] = useState<ProductDefaultItemsRulesV2>(DEFAULT_PRODUCT_RULES_V2);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mp-order");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setOrders(data.orders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetch("/api/product-rules")
      .then((r) => r.json())
      .then((d: { rules?: unknown }) => {
        if (d.rules) setProductRules(normalizeProductDefaultItemsRules(d.rules));
      })
      .catch(() => {});
  }, [load]);

  function startEdit(o: OrderRow) {
    const adres = splitVolledigAdres(o.volledig_adres ?? "");
    const parsed = parseMpProductenFromLineItemsJson(o.line_items_json);
    const producten: ProductRegel[] =
      parsed.length > 0
        ? parsed.map((p) => ({
            id: mkId(),
            type: p.type,
            naam: p.naam,
            prijs: p.prijs != null ? String(p.prijs) : "",
            levering: p.levering,
            montageOpmerking: p.montageOpmerking ?? "",
            achterzitje: p.achterzitje ?? null,
            achterzitjeGemonteerd: p.achterzitjeGemonteerd ?? null,
            voorrekje: p.voorrekje ?? null,
            voorrekjeGemonteerd: p.voorrekjeGemonteerd ?? null,
            shopify_product_id: p.shopify_product_id ?? null,
            shopify_variant_id: p.shopify_variant_id ?? null,
          }))
        : [defaultProduct()];

    setEdit({
      id: o.id,
      order_nummer: o.order_nummer,
      naam: o.naam ?? "",
      email: o.email ?? "",
      telefoonnummer: o.telefoon_nummer ?? "",
      straatnaam: adres.straatnaam,
      huisnummer: adres.huisnummer,
      postcode: adres.postcode,
      woonplaats: adres.woonplaats,
      bezorgtijd_voorkeur:
        o.bezorgtijd_voorkeur === "geen" ? "x" : (o.bezorgtijd_voorkeur ?? ""),
      datum_voorkeur: o.datum_opmerking ?? "",
      opmerking:
        o.opmerkingen_klant === "geen opmerking" ? "x" : (o.opmerkingen_klant ?? ""),
      producten,
    });
    setSaveError(null);
    setConfirmOpen(false);
  }

  function updateProduct(id: number, patch: Partial<ProductRegel>) {
    setEdit((prev) =>
      prev
        ? {
            ...prev,
            producten: prev.producten.map((p) =>
              p.id === id ? { ...p, ...patch } : p
            ),
          }
        : prev
    );
  }

  function removeProduct(id: number) {
    setEdit((prev) =>
      prev
        ? { ...prev, producten: prev.producten.filter((p) => p.id !== id) }
        : prev
    );
  }

  function addProduct() {
    setEdit((prev) =>
      prev ? { ...prev, producten: [...prev.producten, defaultProduct()] } : prev
    );
  }

  async function deleteOrder(o: OrderRow) {
    const label = o.order_nummer || o.naam || "deze order";
    if (
      !confirm(
        `Order ${label} definitief verwijderen?\n\nDit haalt de order uit ritjes/gepland en draait voorraadreserveringen terug.\nDit kan niet ongedaan worden gemaakt.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${o.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      if (edit?.id === o.id) {
        setEdit(null);
        setConfirmOpen(false);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!edit) return;
    if (!edit.naam.trim()) {
      setSaveError("Naam klant is verplicht.");
      return;
    }
    if (edit.producten.some((p) => !p.naam.trim())) {
      setSaveError("Vul alle productnamen in.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/mp-order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: edit.id,
          naam: edit.naam,
          email: edit.email,
          telefoonnummer: edit.telefoonnummer,
          straatnaam: edit.straatnaam,
          huisnummer: edit.huisnummer,
          postcode: edit.postcode,
          woonplaats: edit.woonplaats,
          bezorgtijd_voorkeur: edit.bezorgtijd_voorkeur,
          datum_voorkeur: edit.datum_voorkeur,
          opmerking: edit.opmerking,
          producten_lijst: edit.producten,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setEdit(null);
      setConfirmOpen(false);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Opslaan mislukt");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const totaal = edit
    ? edit.producten.reduce(
        (sum, p) => sum + (parseFloat(String(p.prijs).replace(",", ".")) || 0),
        0
      )
    : 0;

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/marktplaats"
              className="text-koopje-black/60 transition hover:text-koopje-black"
              aria-label="Terug"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
              Geplande MP orders
            </h1>
          </div>

          <p className="mb-6 text-sm text-koopje-black/60">
            Alle Marktplaats-orders in ritjes vandaag of planning. Wijzigingen worden
            direct opgeslagen op dezelfde order.
          </p>

          {loading && <p className="text-sm text-koopje-black/50">Laden…</p>}
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {!loading && !error && orders.length === 0 && (
            <p className="text-sm text-koopje-black/50">Geen geplande MP-orders.</p>
          )}

          <ul className="space-y-3">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-2 rounded-xl border border-koopje-black/10 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-koopje-black">
                      {o.order_nummer ?? "—"}
                    </span>
                    <span className="rounded-md bg-koopje-orange-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-koopje-orange">
                      {statusLabel(o.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-koopje-black/70">
                    {o.naam ?? "Onbekend"}
                    {o.volledig_adres ? ` · ${o.volledig_adres}` : ""}
                  </p>
                  {o.producten && (
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-koopje-black/50">
                      {o.producten}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(o)}
                    className="rounded-xl border border-koopje-black/15 px-4 py-2 text-sm font-medium text-koopje-black transition hover:border-koopje-orange hover:text-koopje-orange"
                  >
                    Bewerken
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteOrder(o)}
                    disabled={saving}
                    className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    Verwijderen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </main>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="max-h-[95vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-koopje-black">Order bewerken</h2>
                <p className="text-sm text-koopje-black/50">{edit.order_nummer}</p>
              </div>
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                aria-label="Sluiten"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-6">
              <div className="space-y-4 rounded-xl border border-koopje-black/10 bg-koopje-black/[0.02] px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-koopje-black/50">
                  Klantgegevens
                </p>
                <div>
                  <label className="mb-1 block text-sm font-medium text-koopje-black">
                    Naam klant<span className="ml-1 text-koopje-orange">*</span>
                  </label>
                  <input
                    value={edit.naam}
                    onChange={(e) => setEdit({ ...edit, naam: e.target.value })}
                    className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                  />
                </div>
                <AdresAutocomplete
                  velden={{
                    straatnaam: edit.straatnaam,
                    huisnummer: edit.huisnummer,
                    postcode: edit.postcode,
                    woonplaats: edit.woonplaats,
                  }}
                  onChange={(v) =>
                    setEdit((prev) =>
                      prev
                        ? {
                            ...prev,
                            straatnaam: v.straatnaam,
                            huisnummer: v.huisnummer,
                            postcode: v.postcode,
                            woonplaats: v.woonplaats,
                          }
                        : prev
                    )
                  }
                />
                <div>
                  <label className="mb-1 block text-sm font-medium text-koopje-black">
                    Telefoonnummer
                  </label>
                  <input
                    type="tel"
                    value={edit.telefoonnummer}
                    onChange={(e) => setEdit({ ...edit, telefoonnummer: e.target.value })}
                    className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-koopje-black">Email</label>
                  <input
                    type="email"
                    value={edit.email}
                    onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                    className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-koopje-orange/30 bg-koopje-orange-light/20 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-koopje-orange">
                  Bezorggegevens
                </p>
                <div>
                  <label className="mb-1 block text-sm font-medium text-koopje-black">
                    Bezorgtijd voorkeur
                  </label>
                  <input
                    value={edit.bezorgtijd_voorkeur}
                    onChange={(e) =>
                      setEdit({ ...edit, bezorgtijd_voorkeur: e.target.value })
                    }
                    placeholder="bijv. na 16:00 of x"
                    className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-koopje-black">
                    Datum voorkeur
                  </label>
                  <input
                    value={edit.datum_voorkeur}
                    onChange={(e) => setEdit({ ...edit, datum_voorkeur: e.target.value })}
                    placeholder="bijv. 14 april of x"
                    className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-koopje-black">
                    Opmerking
                  </label>
                  <input
                    value={edit.opmerking}
                    onChange={(e) => setEdit({ ...edit, opmerking: e.target.value })}
                    placeholder="bijv. bellen voor bezorging of x"
                    className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-koopje-black/10 bg-koopje-black/[0.02] px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-koopje-black/50">
                  Producten
                </p>
                <div className="space-y-4">
                  {edit.producten.map((product, idx) => (
                    <div
                      key={product.id}
                      className={`relative rounded-xl border px-4 py-4 ${
                        product.type === "fiets"
                          ? "border-koopje-orange/30 bg-orange-50/60"
                          : "border-stone-200 bg-white"
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-koopje-black/60">
                          Product {idx + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="flex overflow-hidden rounded-lg border border-stone-200">
                            {(["fiets", "extra"] as MpProductType[]).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => updateProduct(product.id, { type: t })}
                                className={`px-3 py-1 text-xs font-medium transition ${
                                  product.type === t
                                    ? "bg-koopje-orange text-white"
                                    : "bg-white text-stone-500 hover:bg-stone-50"
                                }`}
                              >
                                {t === "fiets" ? "🚲 Fiets" : "📦 Extra"}
                              </button>
                            ))}
                          </div>
                          {edit.producten.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeProduct(product.id)}
                              className="rounded-lg border border-stone-200 p-1 text-stone-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mb-3 flex gap-3">
                        <div className="flex-1">
                          <ProductAutocomplete
                            searchSource="shopify"
                            productKind={product.type}
                            label={product.type === "fiets" ? "Fietsnaam" : "Productnaam"}
                            required
                            value={product.naam}
                            onChange={(naam, _prijs, meta) => {
                              updateProduct(product.id, {
                                naam,
                                shopify_product_id: meta?.shopify_product_id ?? null,
                                shopify_variant_id: meta?.shopify_variant_id ?? null,
                              });
                            }}
                            placeholder={
                              product.type === "fiets"
                                ? "bijv. V20 PRO Fatbike 2026"
                                : "bijv. telefoonhouder"
                            }
                          />
                        </div>
                        <div className="w-28 shrink-0">
                          <label className="mb-1 block text-sm font-medium text-koopje-black">
                            Prijs (€)
                          </label>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-koopje-black/40">
                              €
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={product.prijs}
                              onChange={(e) =>
                                updateProduct(product.id, { prijs: e.target.value })
                              }
                              placeholder="0"
                              className="w-full rounded-xl border border-koopje-black/20 py-2.5 pl-7 pr-2 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                            />
                          </div>
                        </div>
                      </div>

                      {product.type === "fiets" && (
                        <>
                          <div className="mb-3">
                            <label className="mb-2 block text-sm font-medium text-koopje-black">
                              Levering
                            </label>
                            <LeveringKeuze
                              value={product.levering}
                              onChange={(v) => updateProduct(product.id, { levering: v })}
                            />
                          </div>
                          <StandaardProductenLijst
                            naam={product.naam}
                            levering={product.levering}
                            rules={productRules}
                          />
                          <div className="mb-3 space-y-3 rounded-lg border border-stone-200 bg-white/70 p-3">
                            <JaNeeKeuze
                              label="Achterzitje?"
                              value={product.achterzitje}
                              onChange={(v) =>
                                updateProduct(product.id, {
                                  achterzitje: v,
                                  achterzitjeGemonteerd:
                                    v === "nee" ? null : product.achterzitjeGemonteerd,
                                })
                              }
                            />
                            {product.achterzitje === "ja" && (
                              <div className="ml-4 border-l-2 border-green-200 pl-3">
                                <JaNeeKeuze
                                  label="Achterzitje gemonteerd?"
                                  value={product.achterzitjeGemonteerd}
                                  onChange={(v) =>
                                    updateProduct(product.id, {
                                      achterzitjeGemonteerd: v,
                                    })
                                  }
                                />
                              </div>
                            )}
                            <JaNeeKeuze
                              label="Voorrekje?"
                              value={product.voorrekje}
                              onChange={(v) =>
                                updateProduct(product.id, {
                                  voorrekje: v,
                                  voorrekjeGemonteerd:
                                    v === "nee" ? null : product.voorrekjeGemonteerd,
                                })
                              }
                            />
                            {product.voorrekje === "ja" && (
                              <div className="ml-4 border-l-2 border-green-200 pl-3">
                                <JaNeeKeuze
                                  label="Voorrekje gemonteerd?"
                                  value={product.voorrekjeGemonteerd}
                                  onChange={(v) =>
                                    updateProduct(product.id, { voorrekjeGemonteerd: v })
                                  }
                                />
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-medium text-koopje-black">
                              Extra montage opmerkingen
                            </label>
                            <input
                              type="text"
                              value={product.montageOpmerking}
                              onChange={(e) =>
                                updateProduct(product.id, {
                                  montageOpmerking: e.target.value,
                                })
                              }
                              placeholder="bijv. spatborden monteren"
                              className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addProduct}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-200 py-2.5 text-sm font-medium text-stone-500 transition hover:border-koopje-orange/50 hover:text-koopje-orange"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Product toevoegen
                </button>

                <div className="flex items-center justify-between rounded-xl border border-koopje-black/10 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-koopje-black">Totaal</span>
                  <span className="text-base font-semibold text-koopje-black">
                    €{" "}
                    {totaal.toLocaleString("nl-NL", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>

              {saveError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {saveError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setEdit(null)}
                  className="flex-1 rounded-xl border border-koopje-black/15 py-3 text-sm font-medium text-koopje-black"
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-koopje-orange py-3 text-sm font-semibold text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
                >
                  Opslaan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && edit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-koopje-black">Wijzigingen opslaan?</h3>
            <p className="mt-2 text-sm text-koopje-black/60">
              De order wordt bijgewerkt in ritjes vandaag / planning.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={saving}
                className="flex-1 rounded-xl border border-koopje-black/15 py-2.5 text-sm font-medium"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={saving}
                className="flex-1 rounded-xl bg-koopje-orange py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Opslaan…" : "Bevestigen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
