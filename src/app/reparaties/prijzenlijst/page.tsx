"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import {
  ARBEID_UUR_PRIJS_INCL,
  arbeidPrijsIncl,
  type ReparatieStandaardItem,
  type VoorrijkostenSettings,
} from "@/lib/reparaties";

export default function ReparatiePrijzenlijstPage() {
  const [items, setItems] = useState<ReparatieStandaardItem[]>([]);
  const [settings, setSettings] = useState<VoorrijkostenSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newNaam, setNewNaam] = useState("");
  const [newOnderdeel, setNewOnderdeel] = useState("");
  const [newPrijs, setNewPrijs] = useState("");
  const [newUren, setNewUren] = useState("1");
  const [newShopifyProductId, setNewShopifyProductId] = useState<number | null>(null);
  const [newShopifyVariantId, setNewShopifyVariantId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, vRes] = await Promise.all([
        fetch("/api/reparaties/prijslijst?all=1"),
        fetch("/api/reparaties/voorrijkosten"),
      ]);
      const pData = await pRes.json();
      const vData = await vRes.json();
      if (!pRes.ok) throw new Error(pData.error || "Prijzenlijst laden mislukt");
      if (!vRes.ok) throw new Error(vData.error || "Voorrijkosten laden mislukt");
      setItems(pData.items ?? []);
      setSettings(vData.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reparaties/voorrijkosten", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setSettings(data.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function addItem() {
    if (!newNaam.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reparaties/prijslijst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam: newNaam.trim(),
          onderdeel_naam: newOnderdeel.trim() || newNaam.trim(),
          onderdeel_prijs_incl: parseFloat(newPrijs.replace(",", ".")) || 0,
          arbeid_uren: parseFloat(newUren.replace(",", ".")) || 0,
          shopify_product_id: newShopifyProductId,
          shopify_variant_id: newShopifyVariantId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toevoegen mislukt");
      setNewNaam("");
      setNewOnderdeel("");
      setNewPrijs("");
      setNewUren("1");
      setNewShopifyProductId(null);
      setNewShopifyVariantId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toevoegen mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function patchItem(id: string, patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reparaties/prijslijst", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      setItems((prev) =>
        prev.map((i) => (i.id === id ? (data.item as ReparatieStandaardItem) : i))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bijwerken mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    if (!confirm("Deze standaardreparatie deactiveren?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/reparaties/prijslijst?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <div className="mb-6 flex items-center gap-4">
            <Link href="/reparaties" className="text-koopje-black/60 hover:text-koopje-black">
              ← Terug
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black">Prijzenlijst reparaties</h1>
          </div>

          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          {loading && <p className="text-sm text-koopje-black/50">Laden…</p>}

          {settings && (
            <section className="mb-10 rounded-xl border border-koopje-black/10 p-5">
              <h2 className="font-medium text-koopje-black">Voorrijkosten</h2>
              <p className="mt-1 text-sm text-koopje-black/60">
                Standaard: basis + €/km, afgerond per stap (bijv. €32 → €30, €33 → €35).
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  Basis (€)
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-koopje-black/20 px-3 py-2"
                    value={settings.basis_eur}
                    onChange={(e) =>
                      setSettings({ ...settings, basis_eur: Number(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className="text-sm">
                  Per km (€)
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-koopje-black/20 px-3 py-2"
                    value={settings.per_km_eur}
                    onChange={(e) =>
                      setSettings({ ...settings, per_km_eur: Number(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className="text-sm">
                  Afronding (€)
                  <input
                    type="number"
                    step="1"
                    className="mt-1 w-full rounded-lg border border-koopje-black/20 px-3 py-2"
                    value={settings.afronding_eur}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        afronding_eur: Number(e.target.value) || 5,
                      })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveSettings()}
                className="mt-4 rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Voorrijkosten opslaan
              </button>
            </section>
          )}

          <section>
            <h2 className="font-medium text-koopje-black">Standaardreparaties</h2>
            <p className="mt-1 text-sm text-koopje-black/60">
              Onderdeel = 21% BTW (koppel een Shopify-product voor voorraadafschrijving). Arbeid =
              uren × €{ARBEID_UUR_PRIJS_INCL.toFixed(2)} incl. 9% BTW.
            </p>

            <div className="mt-4 space-y-3">
              {items
                .filter((i) => i.active)
                .map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-koopje-black/10 p-4"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-xs text-koopje-black/50">
                        Naam
                        <input
                          className="mt-0.5 w-full rounded border border-koopje-black/20 px-2 py-1.5 text-sm"
                          defaultValue={item.naam}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== item.naam) void patchItem(item.id, { naam: v });
                          }}
                        />
                      </label>
                      <div
                        className="sm:col-span-2"
                        onBlur={(e) => {
                          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                          const current = items.find((i) => i.id === item.id);
                          if (!current) return;
                          void patchItem(item.id, {
                            onderdeel_naam: current.onderdeel_naam ?? "",
                            shopify_product_id: current.shopify_product_id,
                            shopify_variant_id: current.shopify_variant_id,
                            onderdeel_prijs_incl: current.onderdeel_prijs_incl,
                          });
                        }}
                      >
                        <ProductAutocomplete
                          label="Onderdeel (Shopify)"
                          value={item.onderdeel_naam ?? ""}
                          searchSource="shopify"
                          placeholder="Zoek Shopify-product…"
                          onChange={(title, prijs, meta) => {
                            const selected = meta !== undefined;
                            const nextPrijs =
                              prijs != null && prijs !== ""
                                ? parseFloat(String(prijs).replace(",", ".")) || 0
                                : Number(item.onderdeel_prijs_incl);
                            const nextProductId = selected
                              ? (meta.shopify_product_id ?? null)
                              : null;
                            const nextVariantId = selected
                              ? (meta.shopify_variant_id ?? null)
                              : null;
                            setItems((prev) =>
                              prev.map((i) =>
                                i.id === item.id
                                  ? {
                                      ...i,
                                      onderdeel_naam: title,
                                      onderdeel_prijs_incl: nextPrijs,
                                      shopify_product_id: nextProductId,
                                      shopify_variant_id: nextVariantId,
                                    }
                                  : i
                              )
                            );
                            if (selected) {
                              void patchItem(item.id, {
                                onderdeel_naam: title,
                                onderdeel_prijs_incl: nextPrijs,
                                shopify_product_id: nextProductId,
                                shopify_variant_id: nextVariantId,
                              });
                            }
                          }}
                        />
                        <p className="mt-1 text-xs text-koopje-black/45">
                          {item.shopify_product_id
                            ? `Shopify gekoppeld (product ${item.shopify_product_id}${
                                item.shopify_variant_id
                                  ? ` / variant ${item.shopify_variant_id}`
                                  : ""
                              })`
                            : "Nog geen Shopify-product gekoppeld — typ en kies uit de suggesties."}
                        </p>
                      </div>
                      <label className="text-xs text-koopje-black/50">
                        Onderdeelprijs incl. 21% (€)
                        <input
                          type="number"
                          step="0.01"
                          className="mt-0.5 w-full rounded border border-koopje-black/20 px-2 py-1.5 text-sm"
                          value={item.onderdeel_prijs_incl}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setItems((prev) =>
                              prev.map((i) =>
                                i.id === item.id ? { ...i, onderdeel_prijs_incl: v } : i
                              )
                            );
                          }}
                          onBlur={(e) => {
                            const v = Number(e.target.value) || 0;
                            void patchItem(item.id, { onderdeel_prijs_incl: v });
                          }}
                        />
                      </label>
                      <label className="text-xs text-koopje-black/50">
                        Arbeidsuren
                        <input
                          type="number"
                          step="0.25"
                          className="mt-0.5 w-full rounded border border-koopje-black/20 px-2 py-1.5 text-sm"
                          defaultValue={item.arbeid_uren}
                          onBlur={(e) => {
                            const v = Number(e.target.value) || 0;
                            if (v !== Number(item.arbeid_uren)) {
                              void patchItem(item.id, { arbeid_uren: v });
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-koopje-black/50">
                      <span>
                        Arbeid ≈ €{arbeidPrijsIncl(Number(item.arbeid_uren)).toFixed(2)} incl. 9%
                        {" · "}
                        Totaal ≈ €
                        {(
                          Number(item.onderdeel_prijs_incl) +
                          arbeidPrijsIncl(Number(item.arbeid_uren))
                        ).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => void removeItem(item.id)}
                      >
                        Deactiveren
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            <div className="mt-6 rounded-xl border border-dashed border-koopje-black/20 p-4">
              <h3 className="text-sm font-medium text-koopje-black">Nieuwe standaardreparatie</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-koopje-black/50 sm:col-span-2">
                  Naam
                  <input
                    placeholder="bijv. Trapsensor vervangen"
                    className="mt-0.5 w-full rounded border border-koopje-black/20 px-3 py-2 text-sm"
                    value={newNaam}
                    onChange={(e) => setNewNaam(e.target.value)}
                  />
                </label>
                <div className="sm:col-span-2">
                  <ProductAutocomplete
                    label="Onderdeel (Shopify)"
                    value={newOnderdeel}
                    searchSource="shopify"
                    placeholder="Zoek Shopify-product…"
                    onChange={(title, prijs, meta) => {
                      setNewOnderdeel(title);
                      if (prijs != null && prijs !== "") {
                        setNewPrijs(String(prijs));
                      }
                      if (meta !== undefined) {
                        setNewShopifyProductId(meta.shopify_product_id ?? null);
                        setNewShopifyVariantId(meta.shopify_variant_id ?? null);
                      } else {
                        // Vrije tekst zonder selectie → geen voorraadkoppeling.
                        setNewShopifyProductId(null);
                        setNewShopifyVariantId(null);
                      }
                    }}
                  />
                  <p className="mt-1 text-xs text-koopje-black/45">
                    {newShopifyProductId
                      ? `Shopify gekoppeld (product ${newShopifyProductId}${
                          newShopifyVariantId ? ` / variant ${newShopifyVariantId}` : ""
                        })`
                      : "Kies een product uit de suggesties om voorraad correct af te schrijven."}
                  </p>
                </div>
                <label className="text-xs text-koopje-black/50">
                  Onderdeelprijs incl. €
                  <input
                    className="mt-0.5 w-full rounded border border-koopje-black/20 px-3 py-2 text-sm"
                    value={newPrijs}
                    onChange={(e) => setNewPrijs(e.target.value)}
                  />
                </label>
                <label className="text-xs text-koopje-black/50">
                  Arbeidsuren
                  <input
                    className="mt-0.5 w-full rounded border border-koopje-black/20 px-3 py-2 text-sm"
                    value={newUren}
                    onChange={(e) => setNewUren(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={saving || !newNaam.trim()}
                onClick={() => void addItem()}
                className="mt-3 rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Toevoegen
              </button>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
