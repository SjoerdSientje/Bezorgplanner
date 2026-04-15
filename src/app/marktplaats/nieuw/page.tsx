"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import AdresAutocomplete from "@/components/AdresAutocomplete";

type Soort = "bezorging" | "afhaal";
type ProductType = "fiets" | "extra";
type Levering = "Volledig rijklaar" | "In doos";
type JaNee = "ja" | "nee" | null;

interface ProductRegel {
  id: number;
  type: ProductType;
  naam: string;
  levering: Levering;
  montageOpmerking: string;
  achterzitje: JaNee;
  achterzitjeGemonteerd: JaNee;
  voorrekje: JaNee;
  voorrekjeGemonteerd: JaNee;
}

interface FormData {
  naam: string;
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  telefoonnummer: string;
  email: string;
  serienummer: string;
  bezorgtijd_voorkeur: string;
  datum_voorkeur: string;
  opmerking: string;
  totaal_prijs: string;
}

const EMPTY: FormData = {
  naam: "",
  straatnaam: "",
  huisnummer: "",
  postcode: "",
  woonplaats: "",
  telefoonnummer: "",
  email: "",
  serienummer: "",
  bezorgtijd_voorkeur: "",
  datum_voorkeur: "",
  opmerking: "",
  totaal_prijs: "",
};

let nextId = 1;
function mkId() { return nextId++; }

function defaultProduct(): ProductRegel {
  return {
    id: mkId(), type: "fiets", naam: "", levering: "Volledig rijklaar", montageOpmerking: "",
    achterzitje: null, achterzitjeGemonteerd: null,
    voorrekje: null, voorrekjeGemonteerd: null,
  };
}

function JaNeeKeuze({
  label, value, onChange,
}: {
  label: string;
  value: JaNee;
  onChange: (v: JaNee) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-koopje-black">{label}</p>
      <div className="flex gap-2">
        {(["ja", "nee"] as JaNee[]).map((opt) => (
          <button
            key={opt} type="button"
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

function Field({
  label, id, type = "text", value, onChange, placeholder, required, hint,
}: {
  label: string; id: keyof FormData; type?: string; value: string;
  onChange: (id: keyof FormData, v: string) => void;
  placeholder?: string; required?: boolean; hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-koopje-black">
        {label}{required && <span className="ml-1 text-koopje-orange">*</span>}
      </label>
      {hint && <p className="mb-1.5 text-xs text-koopje-black/50">{hint}</p>}
      <input
        id={id} type={type} value={value}
        onChange={(e) => onChange(id, e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/30 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
      />
    </div>
  );
}

function LeveringKeuze({ value, onChange }: { value: Levering; onChange: (v: Levering) => void }) {
  return (
    <div className="flex gap-2">
      {(["Volledig rijklaar", "In doos"] as Levering[]).map((opt) => (
        <button
          key={opt} type="button"
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

export default function NieuweMarktplaatsOrderPage() {
  const router = useRouter();
  const [soort, setSoort] = useState<Soort | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [producten, setProducten] = useState<ProductRegel[]>([defaultProduct()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [garantieWarning, setGarantieWarning] = useState<string | null>(null);

  function setField(id: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [id]: value }));
  }

  function handleSoortChange(s: Soort) {
    setSoort(s);
    setError(null);
    setSuccess(null);
  }

  function updateProduct(id: number, patch: Partial<ProductRegel>) {
    setProducten((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  }

  function removeProduct(id: number) {
    setProducten((prev) => prev.filter((p) => p.id !== id));
  }

  function addProduct() {
    setProducten((prev) => [...prev, defaultProduct()]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!soort) return;
    if (!form.naam.trim()) { setError("Naam klant is verplicht."); return; }
    if (producten.some((p) => !p.naam.trim())) { setError("Vul alle productnamen in."); return; }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setGarantieWarning(null);

    try {
      const res = await fetch("/api/mp-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soort, ...form, producten_lijst: producten }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Opslaan mislukt."); return; }
      setSuccess(data.message ?? "Order opgeslagen.");
      if (data.garantieError) setGarantieWarning(data.garantieError);
      setForm(EMPTY);
      setProducten([defaultProduct()]);
      setSoort(null);
      const redirectUrl = soort === "bezorging"
        ? "/bezorgplanner/ritjes-vandaag"
        : "/bezorgplanner/mp-orders";
      setTimeout(() => { window.location.href = redirectUrl; }, data.garantieError ? 5000 : 2500);
    } catch {
      setError("Er ging iets mis. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
            <Link href="/" className="text-koopje-black/60 transition hover:text-koopje-black" aria-label="Terug">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Nieuwe Marktplaats order</h1>
          </div>

          {success && (
            <div className="mb-6 space-y-3">
              <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800">
                <p className="font-semibold">✓ {success}</p>
                <p className="mt-1 text-green-700/80">Je wordt doorgestuurd…</p>
              </div>
              {garantieWarning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                  <p className="font-semibold">Garantiebewijs/email mislukt</p>
                  <p className="mt-1 text-amber-700/90">{garantieWarning}</p>
                </div>
              )}
            </div>
          )}

          {/* Soort */}
          <div className="mb-6">
            <p className="mb-3 text-sm font-medium text-koopje-black">
              Afgehaald of bezorgen?<span className="ml-1 text-koopje-orange">*</span>
            </p>
            <div className="flex gap-3">
              {(["afhaal", "bezorging"] as Soort[]).map((s) => (
                <button key={s} type="button" onClick={() => handleSoortChange(s)}
                  className={`flex-1 rounded-xl border-2 px-4 py-3 text-left transition ${
                    soort === s
                      ? "border-koopje-orange bg-koopje-orange-light"
                      : "border-koopje-black/10 bg-white hover:border-koopje-orange/40"
                  }`}
                >
                  <span className="block text-sm font-medium text-koopje-black">
                    {s === "afhaal" ? "Afgehaald" : "Bezorgen"}
                  </span>
                  <span className="mt-0.5 block text-xs text-koopje-black/60">
                    {s === "afhaal" ? "Klant haalt op in winkel" : "Order wordt bij klant bezorgd"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {soort && (
            <form onSubmit={handleSubmit} className="space-y-8">

              {/* Klantgegevens */}
              <div className="space-y-4 rounded-xl border border-koopje-black/10 bg-koopje-black/[0.02] px-5 py-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-koopje-black/50">Klantgegevens</p>
                {soort === "afhaal" && (
                  <Field label="Serienummer" id="serienummer" value={form.serienummer} onChange={setField} placeholder="bijv. XYZ123456" />
                )}
                <Field label="Naam klant" id="naam" value={form.naam} onChange={setField} placeholder="Voor- en achternaam" required />
                <AdresAutocomplete
                  velden={{
                    straatnaam: form.straatnaam,
                    huisnummer: form.huisnummer,
                    postcode: form.postcode,
                    woonplaats: form.woonplaats,
                  }}
                  onChange={(v) => setForm((prev) => ({
                    ...prev,
                    straatnaam: v.straatnaam,
                    huisnummer: v.huisnummer,
                    postcode: v.postcode,
                    woonplaats: v.woonplaats,
                  }))}
                />
                <Field label="Telefoonnummer" id="telefoonnummer" type="tel" value={form.telefoonnummer} onChange={setField} placeholder="06 12345678" />
                <Field label="Email" id="email" type="email" value={form.email} onChange={setField} placeholder="klant@email.nl" />
              </div>

              {/* Bezorggegevens */}
              {soort === "bezorging" && (
                <div className="space-y-4 rounded-xl border border-koopje-orange/30 bg-koopje-orange-light/20 px-5 py-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-koopje-orange">Bezorggegevens</p>
                  <Field label="Bezorgtijd voorkeur" id="bezorgtijd_voorkeur" value={form.bezorgtijd_voorkeur} onChange={setField}
                    placeholder="bijv. na 16:00 of x" hint="Vul 'x' in als de klant geen voorkeur heeft" />
                  <Field label="Datum voorkeur" id="datum_voorkeur" value={form.datum_voorkeur} onChange={setField}
                    placeholder="bijv. 14 april of x" hint="Vul 'x' in als de klant geen voorkeur heeft" />
                  <Field label="Opmerking klant / Sjoerd" id="opmerking" value={form.opmerking} onChange={setField}
                    placeholder="bijv. bellen voor bezorging of x" hint="Vul 'x' in als er geen opmerking is" />
                </div>
              )}

              {/* Producten */}
              <div className="space-y-4 rounded-xl border border-koopje-black/10 bg-koopje-black/[0.02] px-5 py-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-koopje-black/50">Producten</p>

                <div className="space-y-4">
                  {producten.map((product, idx) => (
                    <div
                      key={product.id}
                      className={`relative rounded-xl border px-4 py-4 ${
                        product.type === "fiets"
                          ? "border-koopje-orange/30 bg-orange-50/60"
                          : "border-stone-200 bg-white"
                      }`}
                    >
                      {/* Header rij */}
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-koopje-black/60">
                          {idx === 0 ? "Product 1 (fiets)" : `Product ${idx + 1}`}
                        </span>
                        {idx > 0 && (
                          <div className="flex items-center gap-2">
                            {/* Fiets / Extra toggle */}
                            <div className="flex overflow-hidden rounded-lg border border-stone-200">
                              {(["fiets", "extra"] as ProductType[]).map((t) => (
                                <button key={t} type="button"
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
                            <button type="button" onClick={() => removeProduct(product.id)}
                              className="rounded-lg border border-stone-200 p-1 text-stone-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Naam */}
                      <div className="mb-3">
                        <label className="mb-1 block text-sm font-medium text-koopje-black">
                          {product.type === "fiets" ? "Fietsnaam" : "Productnaam"}
                          <span className="ml-1 text-koopje-orange">*</span>
                        </label>
                        <input
                          type="text"
                          value={product.naam}
                          onChange={(e) => updateProduct(product.id, { naam: e.target.value })}
                          placeholder={product.type === "fiets" ? "bijv. V20 PRO Fatbike 2026" : "bijv. telefoonhouder"}
                          className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/30 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                        />
                      </div>

                      {/* Levering — alleen voor fietsen */}
                      {product.type === "fiets" && (
                        <div className="mb-3">
                          <label className="mb-2 block text-sm font-medium text-koopje-black">Levering</label>
                          <LeveringKeuze
                            value={product.levering}
                            onChange={(v) => updateProduct(product.id, { levering: v })}
                          />
                        </div>
                      )}

                      {/* Achterzitje + Voorrekje — fiets + bezorging */}
                      {product.type === "fiets" && soort === "bezorging" && (
                        <div className="mb-3 space-y-3 rounded-lg border border-stone-200 bg-white/70 p-3">
                          {/* Achterzitje */}
                          <JaNeeKeuze
                            label="Achterzitje?"
                            value={product.achterzitje}
                            onChange={(v) => updateProduct(product.id, {
                              achterzitje: v,
                              achterzitjeGemonteerd: v === "nee" ? null : product.achterzitjeGemonteerd,
                            })}
                          />
                          {product.achterzitje === "ja" && (
                            <div className="ml-4 border-l-2 border-green-200 pl-3">
                              <JaNeeKeuze
                                label="Achterzitje gemonteerd?"
                                value={product.achterzitjeGemonteerd}
                                onChange={(v) => updateProduct(product.id, { achterzitjeGemonteerd: v })}
                              />
                              {product.achterzitjeGemonteerd && (
                                <p className="mt-1.5 text-xs text-koopje-black/50">
                                  {product.achterzitjeGemonteerd === "ja"
                                    ? "→ Wordt als montage-opmerking onder de fiets vermeld"
                                    : "→ Wordt als los product meegenomen in paklijst & afronden"}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Voorrekje */}
                          <JaNeeKeuze
                            label="Voorrekje?"
                            value={product.voorrekje}
                            onChange={(v) => updateProduct(product.id, {
                              voorrekje: v,
                              voorrekjeGemonteerd: v === "nee" ? null : product.voorrekjeGemonteerd,
                            })}
                          />
                          {product.voorrekje === "ja" && (
                            <div className="ml-4 border-l-2 border-green-200 pl-3">
                              <JaNeeKeuze
                                label="Voorrekje gemonteerd?"
                                value={product.voorrekjeGemonteerd}
                                onChange={(v) => updateProduct(product.id, { voorrekjeGemonteerd: v })}
                              />
                              {product.voorrekjeGemonteerd && (
                                <p className="mt-1.5 text-xs text-koopje-black/50">
                                  {product.voorrekjeGemonteerd === "ja"
                                    ? "→ Wordt als montage-opmerking onder de fiets vermeld"
                                    : "→ Wordt als los product meegenomen in paklijst & afronden"}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Montage opmerking — fiets + bezorging */}
                      {product.type === "fiets" && soort === "bezorging" && (
                        <div>
                          <label className="mb-1 block text-sm font-medium text-koopje-black">
                            Extra montage opmerkingen
                          </label>
                          <input
                            type="text"
                            value={product.montageOpmerking}
                            onChange={(e) => updateProduct(product.id, { montageOpmerking: e.target.value })}
                            placeholder="bijv. spatborden monteren, verlichting instellen"
                            className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/30 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* + product toevoegen */}
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

                {/* Totaal prijs */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-koopje-black">
                    Totaal prijs (€)<span className="ml-1 text-koopje-orange">*</span>
                  </label>
                  <input
                    type="number"
                    value={form.totaal_prijs}
                    onChange={(e) => setField("totaal_prijs", e.target.value)}
                    placeholder="850"
                    className="w-full rounded-xl border border-koopje-black/20 px-3 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/30 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-xl border-2 border-red-400 bg-red-50 px-5 py-4 text-sm text-red-800">
                  <p className="mb-1 text-base font-bold">⚠ Opslaan mislukt</p>
                  <p>{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full rounded-xl bg-koopje-orange py-3 text-sm font-semibold text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
              >
                {loading ? "Opslaan…" : "Order opslaan"}
              </button>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
