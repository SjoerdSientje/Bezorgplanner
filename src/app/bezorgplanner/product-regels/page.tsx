"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { DEFAULT_PRODUCT_RULES_V1 } from "@/lib/product-default-items-rules";
import type { ProductDefaultItemsRulesV1 } from "@/lib/product-default-items-rules";

export default function ProductRegelsPage() {
  const [jsonText, setJsonText] = useState("");
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
      const rules = data.rules as ProductDefaultItemsRulesV1;
      setJsonText(JSON.stringify(rules, null, 2));
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new Error("JSON is ongeldig. Controleer komma’s en aanhalingstekens.");
      }
      const res = await fetch("/api/product-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Opslaan mislukt");
      setMessage("Opgeslagen. Nieuwe Shopify/MP-orders gebruiken deze regels.");
      setJsonText(JSON.stringify(data.rules, null, 2));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = () => {
    setJsonText(JSON.stringify(DEFAULT_PRODUCT_RULES_V1, null, 2));
    setMessage("Standaardregels in het veld gezet — klik op Opslaan om dit in de database te zetten.");
  };

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto w-full max-w-none px-4 py-8 sm:px-6 sm:py-12">
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
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Product regels</h1>
          </div>

          <p className="max-w-3xl text-sm text-koopje-black/75">
            Hier staan de regels voor <strong>standaard inbegrepen items</strong> per fiets (Fietspompje,
            levering &quot;Volledig rijklaar&quot; / &quot;In doos&quot;, modelgroepen). Dit wordt gebruikt
            bij het opbouwen van <code className="rounded bg-stone-100 px-1">line_items_json</code> voor
            Shopify-webhooks en MP-orders. Wijzigingen gelden voor <strong>nieuwe</strong> imports; bestaande
            orders in de database veranderen niet.
          </p>

          <div className="mt-6 max-w-4xl rounded-xl border border-koopje-orange/30 bg-orange-50/60 p-4 text-sm text-stone-800">
            <p className="font-semibold text-koopje-black">MP, Shopify webshop en handmatig — wat hoort bij deze JSON?</p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-stone-700">
              <li>
                <strong>Deze JSON bestuurt alleen de lijst met standaard inbegrepen spullen</strong> (onder
                &quot;Standaard inbegrepen&quot; in de producten-popup), op basis van de Shopify-property{" "}
                <strong>Levering</strong> (waarden zoals volledig rijklaar / in doos) en het <strong>model</strong>{" "}
                uit de productnaam. Dat geldt voor elke bron zodra die property op de fiets-regel staat.
              </li>
              <li>
                <strong>Marktplaats (MP)</strong>: bij een nieuwe MP-order wordt de Levering uit het formulier
                op de fiets gezet; dezelfde regels-engine wordt gebruikt als bij Shopify.
              </li>
              <li>
                <strong>Shopify (website)</strong>: orders komen binnen met echte line items en vaak
                properties op de fiets; prijzen komen uit Shopify (regeltotaal).
              </li>
              <li>
                <strong>Shopify handmatig</strong>: orders zonder properties leunen op de <strong>producttitel</strong>{" "}
                (splitsing op <code className="rounded bg-white/80 px-1">+</code> en{" "}
                <code className="rounded bg-white/80 px-1">&amp;</code>, montage-tekst als property op de fiets,
                extra&apos;s als losse regels). <strong>Die titel-logica staat vast in de code</strong> (
                <code className="rounded bg-white/80 px-1">buildLineItemsJson</code> in{" "}
                <code className="rounded bg-white/80 px-1">shopify-order.ts</code>), niet in onderstaande JSON.
              </li>
              <li>
                <strong>Prijzen</strong> (wat de klant betaalt per regel / totaal) worden nergens door deze JSON
                bepaald: Shopify gebruikt orderregels; MP gebruikt het ingevoerde totaal + technische dummy-prijs
                op fietsregels voor de app-logica.
              </li>
            </ul>
          </div>

          {updatedAt && (
            <p className="mt-2 text-xs text-koopje-black/50">
              Laatst opgeslagen: {new Date(updatedAt).toLocaleString("nl-NL")}
              {!fromDatabase && " (nog geen rij in database — toont code-standaard)"}
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
                  Vul standaard (uit code)
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

              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
                className="mt-4 h-[min(70vh,720px)] w-full max-w-5xl rounded-xl border-2 border-stone-300 bg-stone-50 p-4 font-mono text-xs text-stone-900 focus:border-koopje-orange focus:outline-none"
              />

              <div className="mt-6 max-w-3xl rounded-xl border border-stone-200 bg-stone-50/80 p-4 text-xs text-stone-600">
                <p className="font-semibold text-stone-800">Structuur (version 1)</p>
                <ul className="mt-2 list-inside list-disc space-y-1">
                  <li>
                    <code>always</code>: altijd toegevoegd; gebruik <code>{"{model}"}</code> waar het modelnaam
                    moet invullen.
                  </li>
                  <li>
                    <code>excludedBrandKeywords</code>: als de productnaam dit bevat (bijv. engwe), worden de
                    standaard slot/tas (VR) of slot (ID) overgeslagen.
                  </li>
                  <li>
                    <code>volledigRijklaar.standardItems</code> en <code>inDoos.standardItems</code>: voor
                    alle andere merken.
                  </li>
                  <li>
                    <code>modelExtras</code>: lijsten met <code>models</code> (exacte match op modelstring,
                    case-insensitive) en <code>items</code> (ook met <code>{"{model}"}</code>).
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
