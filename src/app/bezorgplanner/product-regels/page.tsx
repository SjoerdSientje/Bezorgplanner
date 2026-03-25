"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import ProductRulesForm from "@/components/ProductRulesForm";
import {
  DEFAULT_PRODUCT_RULES_V1,
  isProductDefaultItemsRulesV1,
} from "@/lib/product-default-items-rules";
import type { ProductDefaultItemsRulesV1 } from "@/lib/product-default-items-rules";

export default function ProductRegelsPage() {
  const [rules, setRules] = useState<ProductDefaultItemsRulesV1>(DEFAULT_PRODUCT_RULES_V1);
  const [jsonDraft, setJsonDraft] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [fromDatabase, setFromDatabase] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/product-rules?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden mislukt");
      const loaded = data.rules as ProductDefaultItemsRulesV1;
      setRules(loaded);
      setJsonDraft(JSON.stringify(loaded, null, 2));
      setUpdatedAt(data.updated_at ?? null);
      setFromDatabase(Boolean(data.fromDatabase));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/product-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Opslaan mislukt");
      setMessage("Opgeslagen. Nieuwe bestellingen gebruiken deze regels.");
      if (data.rules) {
        setRules(data.rules);
        setJsonDraft(JSON.stringify(data.rules, null, 2));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = () => {
    setRules(DEFAULT_PRODUCT_RULES_V1);
    setJsonDraft(JSON.stringify(DEFAULT_PRODUCT_RULES_V1, null, 2));
    setMessage(
      "Standaardregels ingeladen. Klik op Opslaan om dit definitief te maken."
    );
  };

  const applyJsonDraft = () => {
    setError(null);
    setMessage(null);
    try {
      const parsed: unknown = JSON.parse(jsonDraft);
      if (!isProductDefaultItemsRulesV1(parsed)) {
        throw new Error(
          "De JSON klopt niet. Controleer of alle onderdelen aanwezig zijn (versie 1)."
        );
      }
      setRules(parsed);
      setMessage("JSON toegepast op het formulier hierboven. Vergeet niet op Opslaan te klikken.");
    } catch (e) {
      if (e instanceof SyntaxError) {
        setError("JSON is ongeldig. Controleer komma’s en aanhalingstekens.");
      } else {
        setError(e instanceof Error ? e.message : "Kon JSON niet toepassen");
      }
    }
  };

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
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
              Standaard inbegrepen spullen
            </h1>
          </div>

          <p className="text-sm leading-relaxed text-stone-700">
            Hier bepaal je welke items automatisch bij een fiets horen op de paklijst en in
            het productoverzicht — afhankelijk van <strong>hoe de fiets geleverd wordt</strong>{" "}
            (volledig rijklaar of in de doos) en <strong>welk model</strong> het is. Wijzigingen
            gelden voor <strong>nieuwe</strong> orders; bestaande orders in het overzicht blijven
            zoals ze waren.
          </p>

          <details className="mt-5 rounded-xl border border-stone-200 bg-stone-50/90 p-4 text-sm text-stone-700">
            <summary className="cursor-pointer font-medium text-koopje-black">
              Meer uitleg (Shopify, Marktplaats, prijzen)
            </summary>
            <ul className="mt-3 list-inside list-disc space-y-2 pl-0.5">
              <li>
                Deze instellingen sturen alleen de lijst &quot;standaard inbegrepen&quot;, op basis van
                de keuze <strong>Levering</strong> en het <strong>model</strong> uit de productnaam.
              </li>
              <li>
                <strong>Marktplaats</strong>: bij een nieuwe order vult het formulier Levering in;
                dezelfde regels worden gebruikt als bij de webshop.
              </li>
              <li>
                <strong>Webshop (Shopify)</strong>: orders komen binnen met productregels en
                eigenschappen zoals in de winkel zijn ingevuld.
              </li>
              <li>
                <strong>Prijzen</strong> worden hier niet ingesteld; die komen uit de order
                (Shopify) of uit wat je bij Marktplaats invult.
              </li>
            </ul>
          </details>

          {updatedAt && (
            <p className="mt-4 text-xs text-koopje-black/50">
              Laatst opgeslagen: {new Date(updatedAt).toLocaleString("nl-NL")}
              {!fromDatabase && " (nog geen eigen versie — je ziet de fabrieksstandaard)"}
            </p>
          )}

          {loading ? (
            <p className="mt-8 text-sm text-koopje-black/60">Laden…</p>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
                >
                  {saving ? "Opslaan…" : "Opslaan"}
                </button>
                <button
                  type="button"
                  onClick={resetDefault}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  Herstel fabrieksstandaard
                </button>
                <button
                  type="button"
                  onClick={load}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  Herlaad van server
                </button>
              </div>

              {message && (
                <p className="mt-3 text-sm text-green-700">{message}</p>
              )}
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}

              <div className="mt-8">
                <ProductRulesForm rules={rules} onChange={setRules} />
              </div>

              <details
                className="mt-10 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4"
                onToggle={(e) => {
                  const el = e.currentTarget;
                  if (el.open) setJsonDraft(JSON.stringify(rules, null, 2));
                }}
              >
                <summary className="cursor-pointer text-sm font-medium text-stone-800">
                  Geavanceerd: ruwe JSON (alleen voor technische beheerders)
                </summary>
                <p className="mt-3 text-xs text-stone-600">
                  Zelfde inhoud als het formulier; gebruik alleen als je bulk-import of
                  copy-paste vanuit een andere omgeving nodig hebt. Na wijzigingen:{" "}
                  <strong>Pas JSON toe</strong> en daarna <strong>Opslaan</strong>.
                </p>
                <textarea
                  value={jsonDraft}
                  onChange={(e) => setJsonDraft(e.target.value)}
                  spellCheck={false}
                  className="mt-3 h-64 w-full rounded-lg border border-stone-300 bg-white p-3 font-mono text-xs text-stone-900 focus:border-koopje-orange focus:outline-none"
                />
                <button
                  type="button"
                  onClick={applyJsonDraft}
                  className="mt-3 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
                >
                  Pas JSON toe op formulier
                </button>
              </details>
            </>
          )}
        </div>
      </main>
    </>
  );
}
