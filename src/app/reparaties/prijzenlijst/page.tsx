"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import ArbeidUrenInput from "@/components/ArbeidUrenInput";
import {
  ARBEID_UUR_PRIJS_INCL,
  arbeidPrijsIncl,
  normalizeStandaardOnderdelen,
  type ReparatieStandaardItem,
  type VoorrijkostenSettings,
} from "@/lib/reparaties";

type DraftOnderdeel = {
  key: string;
  naam: string;
  prijs_incl: string;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
};

function mkKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyOnderdeel(): DraftOnderdeel {
  return {
    key: mkKey(),
    naam: "",
    prijs_incl: "",
    shopify_product_id: null,
    shopify_variant_id: null,
  };
}

function itemToDrafts(
  item: ReparatieStandaardItem,
  prev?: DraftOnderdeel[]
): DraftOnderdeel[] {
  const onderdelen = normalizeStandaardOnderdelen(item);
  if (onderdelen.length === 0) {
    return prev?.length ? prev : [emptyOnderdeel()];
  }
  return onderdelen.map((o, i) => ({
    // Stabiele keys behouden zodat ProductAutocomplete niet remount na opslaan.
    key: prev?.[i]?.key ?? mkKey(),
    naam: o.naam,
    prijs_incl: o.prijs_incl > 0 ? String(o.prijs_incl) : "",
    shopify_product_id: o.shopify_product_id ?? null,
    shopify_variant_id: o.shopify_variant_id ?? null,
  }));
}

function draftsToPayload(drafts: DraftOnderdeel[]) {
  return drafts
    .filter((d) => d.naam.trim())
    .map((d) => ({
      naam: d.naam.trim(),
      prijs_incl: parseFloat(d.prijs_incl.replace(",", ".")) || 0,
      shopify_product_id: d.shopify_product_id,
      shopify_variant_id: d.shopify_variant_id,
    }));
}

function OnderdelenEditor({
  drafts,
  onChange,
  onCommit,
}: {
  drafts: DraftOnderdeel[];
  onChange: (next: DraftOnderdeel[]) => void;
  onCommit?: (next: DraftOnderdeel[]) => void;
}) {
  function update(key: string, patch: Partial<DraftOnderdeel>, commit = false) {
    const next = drafts.map((d) => (d.key === key ? { ...d, ...patch } : d));
    onChange(next);
    if (commit) onCommit?.(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-koopje-black/60">
        Onderdelen (Shopify) — meerdere mogelijk
      </p>
      {drafts.map((d, idx) => (
        <div
          key={d.key}
          className="rounded-lg border border-koopje-black/10 bg-stone-50/60 p-3"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-koopje-black/45">Onderdeel {idx + 1}</span>
            {drafts.length > 1 && (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => {
                  const next = drafts.filter((x) => x.key !== d.key);
                  onChange(next);
                  onCommit?.(next);
                }}
              >
                Verwijderen
              </button>
            )}
          </div>
          <ProductAutocomplete
            label="Product"
            value={d.naam}
            searchSource="shopify"
            placeholder="Zoek Shopify-product…"
            onChange={(title, prijs, meta) => {
              const selected = meta !== undefined;
              update(
                d.key,
                {
                  naam: title,
                  prijs_incl:
                    prijs != null && prijs !== ""
                      ? String(prijs)
                      : d.prijs_incl,
                  shopify_product_id: selected
                    ? (meta.shopify_product_id ?? null)
                    : null,
                  shopify_variant_id: selected
                    ? (meta.shopify_variant_id ?? null)
                    : null,
                },
                selected
              );
            }}
          />
          <label className="mt-2 block text-xs text-koopje-black/50">
            Prijs incl. 21% (€)
            <input
              className="mt-0.5 w-full rounded border border-koopje-black/20 px-2 py-1.5 text-sm"
              value={d.prijs_incl}
              onChange={(e) => update(d.key, { prijs_incl: e.target.value })}
              onBlur={() => onCommit?.(drafts)}
            />
          </label>
          <p className="mt-1 text-[11px] text-koopje-black/40">
            {d.shopify_product_id
              ? `Shopify gekoppeld (product ${d.shopify_product_id}${
                  d.shopify_variant_id ? ` / variant ${d.shopify_variant_id}` : ""
                })`
              : "Kies uit suggesties voor voorraadafschrijving."}
          </p>
        </div>
      ))}
      <button
        type="button"
        className="rounded-lg border border-koopje-black/20 bg-white px-3 py-1.5 text-sm"
        onClick={() => onChange([...drafts, emptyOnderdeel()])}
      >
        + Onderdeel toevoegen
      </button>
    </div>
  );
}

export default function ReparatiePrijzenlijstPage() {
  const [items, setItems] = useState<ReparatieStandaardItem[]>([]);
  const [onderdelenById, setOnderdelenById] = useState<
    Record<string, DraftOnderdeel[]>
  >({});
  const [settings, setSettings] = useState<VoorrijkostenSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newNaam, setNewNaam] = useState("");
  const [newOnderdelen, setNewOnderdelen] = useState<DraftOnderdeel[]>([
    emptyOnderdeel(),
  ]);
  const [newUren, setNewUren] = useState("1");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

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
      const list = (pData.items ?? []) as ReparatieStandaardItem[];
      setItems(list);
      const drafts: Record<string, DraftOnderdeel[]> = {};
      for (const item of list) {
        drafts[item.id] = itemToDrafts(item);
      }
      setOnderdelenById(drafts);
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
          onderdelen: draftsToPayload(newOnderdelen),
          arbeid_uren: parseFloat(newUren.replace(",", ".")) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toevoegen mislukt");
      setNewNaam("");
      setNewOnderdelen([emptyOnderdeel()]);
      setNewUren("1");
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
      const updated = data.item as ReparatieStandaardItem;
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      if (patch.onderdelen !== undefined) {
        setOnderdelenById((prev) => ({
          ...prev,
          [id]: itemToDrafts(updated, prev[id]),
        }));
      }
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
              Onderdelen = 21% BTW (koppel Shopify-producten voor voorraad). Arbeid = uren × €
              {ARBEID_UUR_PRIJS_INCL.toFixed(2)} incl. 9% BTW.
            </p>

            <div className="mt-4 rounded-xl border border-dashed border-koopje-black/20 p-4">
              <h3 className="text-sm font-medium text-koopje-black">Nieuwe standaardreparatie</h3>
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-koopje-black/50">
                  Naam
                  <input
                    placeholder="bijv. Trapsensor vervangen"
                    className="mt-0.5 w-full rounded border border-koopje-black/20 px-3 py-2 text-sm"
                    value={newNaam}
                    onChange={(e) => setNewNaam(e.target.value)}
                  />
                </label>
                <OnderdelenEditor
                  drafts={newOnderdelen}
                  onChange={setNewOnderdelen}
                />
                <ArbeidUrenInput compact uren={newUren} onUrenChange={setNewUren} />
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

            <div className="mt-6 space-y-2">
              {items
                .filter((i) => i.active)
                .map((item) => {
                  const drafts = onderdelenById[item.id] ?? itemToDrafts(item);
                  const onderdeelTotaal = draftsToPayload(drafts).reduce(
                    (sum, o) => sum + o.prijs_incl,
                    0
                  );
                  const arbeid = arbeidPrijsIncl(Number(item.arbeid_uren));
                  const totaal = onderdeelTotaal + arbeid;
                  const expanded = Boolean(expandedIds[item.id]);
                  const onderdeelSamenvatting =
                    drafts
                      .map((d) => d.naam.trim())
                      .filter(Boolean)
                      .join(" · ") || "Geen onderdelen";

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-koopje-black/10"
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpanded(item.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50"
                        aria-expanded={expanded}
                      >
                        <span
                          className={`mt-0.5 shrink-0 text-koopje-black/40 transition ${
                            expanded ? "rotate-90" : ""
                          }`}
                          aria-hidden
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-koopje-black">
                            {item.naam}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-koopje-black/50">
                            {onderdeelSamenvatting}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-xs text-koopje-black/55">
                          <span className="block font-medium text-koopje-black/80">
                            €{totaal.toFixed(2)}
                          </span>
                          <span className="block">
                            {Number(item.arbeid_uren) || 0} u arbeid
                          </span>
                        </span>
                      </button>

                      {expanded && (
                        <div className="border-t border-koopje-black/10 px-4 pb-4 pt-3">
                          <div className="grid gap-3">
                            <label className="text-xs text-koopje-black/50">
                              Naam
                              <input
                                className="mt-0.5 w-full rounded border border-koopje-black/20 px-2 py-1.5 text-sm"
                                defaultValue={item.naam}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v && v !== item.naam) {
                                    void patchItem(item.id, { naam: v });
                                  }
                                }}
                              />
                            </label>
                            <OnderdelenEditor
                              drafts={drafts}
                              onChange={(next) =>
                                setOnderdelenById((prev) => ({
                                  ...prev,
                                  [item.id]: next,
                                }))
                              }
                              onCommit={(next) =>
                                void patchItem(item.id, {
                                  onderdelen: draftsToPayload(next),
                                })
                              }
                            />
                            <div
                              onBlur={(e) => {
                                if (
                                  e.currentTarget.contains(e.relatedTarget as Node)
                                ) {
                                  return;
                                }
                                const current = items.find((i) => i.id === item.id);
                                if (!current) return;
                                void patchItem(item.id, {
                                  arbeid_uren: Number(current.arbeid_uren) || 0,
                                });
                              }}
                            >
                              <ArbeidUrenInput
                                compact
                                uren={
                                  item.arbeid_uren != null &&
                                  Number(item.arbeid_uren) > 0
                                    ? String(item.arbeid_uren)
                                    : ""
                                }
                                onUrenChange={(u) => {
                                  const v = parseFloat(u.replace(",", ".")) || 0;
                                  setItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id
                                        ? { ...i, arbeid_uren: v }
                                        : i
                                    )
                                  );
                                }}
                              />
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between text-xs text-koopje-black/50">
                            <span>
                              Onderdelen €{onderdeelTotaal.toFixed(2)}
                              {" · "}
                              Arbeid ≈ €{arbeid.toFixed(2)}
                              {" · "}
                              Totaal ≈ €{totaal.toFixed(2)}
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
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
