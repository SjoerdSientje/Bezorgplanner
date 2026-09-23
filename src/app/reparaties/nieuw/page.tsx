"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import AdresAutocomplete from "@/components/AdresAutocomplete";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import {
  ARBEID_UUR_PRIJS_INCL,
  arbeidPrijsIncl,
  type ReparatieBetaalwijze,
  type ReparatieSoort,
  type ReparatieStandaardItem,
} from "@/lib/reparaties";

type RegelMode = "standaard" | "custom";

type DraftRegel = {
  key: string;
  mode: RegelMode;
  standaard_id?: string;
  naam: string;
  onderdeel_naam: string;
  onderdeel_prijs_incl: string;
  shopify_product_id?: number | null;
  shopify_variant_id?: number | null;
  arbeid_uren: string;
};

function mkKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ReparatieNieuwPage() {
  const router = useRouter();
  const [soort, setSoort] = useState<ReparatieSoort>("reparatie_deur");
  const [betaalwijze, setBetaalwijze] = useState<ReparatieBetaalwijze>("factuur");
  const [productenOnbekend, setProductenOnbekend] = useState(false);

  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [straat, setStraat] = useState("");
  const [huisnr, setHuisnr] = useState("");
  const [postcode, setPostcode] = useState("");
  const [woonplaats, setWoonplaats] = useState("");
  const [bezorgtijd, setBezorgtijd] = useState("");
  const [datumVoorkeur, setDatumVoorkeur] = useState("");
  const [opmerking, setOpmerking] = useState("");

  const [standaard, setStandaard] = useState<ReparatieStandaardItem[]>([]);
  const [regels, setRegels] = useState<DraftRegel[]>([]);
  const [voorrij, setVoorrij] = useState<{ km: number; bedrag: number } | null>(null);
  const [voorrijLoading, setVoorrijLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsProducts = soort === "reparatie_deur" && !productenOnbekend;

  useEffect(() => {
    void fetch("/api/reparaties/prijslijst")
      .then((r) => r.json())
      .then((d) => setStandaard(d.items ?? []))
      .catch(() => {});
  }, []);

  const volledigAdres = useMemo(
    () => [straat, huisnr, postcode, woonplaats].filter(Boolean).join(" ").trim(),
    [straat, huisnr, postcode, woonplaats]
  );

  const refreshVoorrij = useCallback(async () => {
    if (volledigAdres.length < 8) {
      setVoorrij(null);
      return;
    }
    setVoorrijLoading(true);
    try {
      const res = await fetch("/api/reparaties/voorrijkosten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adres: volledigAdres }),
      });
      const data = await res.json();
      if (res.ok) setVoorrij({ km: data.km, bedrag: data.bedrag });
      else setVoorrij(null);
    } catch {
      setVoorrij(null);
    } finally {
      setVoorrijLoading(false);
    }
  }, [volledigAdres]);

  useEffect(() => {
    const t = setTimeout(() => void refreshVoorrij(), 600);
    return () => clearTimeout(t);
  }, [refreshVoorrij]);

  const subtotaalRegels = useMemo(() => {
    if (!needsProducts) return 0;
    return regels.reduce((sum, r) => {
      const prijs = parseFloat(r.onderdeel_prijs_incl.replace(",", ".")) || 0;
      const uren = parseFloat(r.arbeid_uren.replace(",", ".")) || 0;
      return sum + prijs + arbeidPrijsIncl(uren);
    }, 0);
  }, [regels, needsProducts]);

  const totaal = subtotaalRegels + (voorrij?.bedrag ?? 0);

  function addStandaardRegel(id: string) {
    const s = standaard.find((i) => i.id === id);
    if (!s) return;
    setRegels((prev) => [
      ...prev,
      {
        key: mkKey(),
        mode: "standaard",
        standaard_id: s.id,
        naam: s.naam,
        onderdeel_naam: s.onderdeel_naam || s.naam,
        onderdeel_prijs_incl: String(s.onderdeel_prijs_incl),
        shopify_product_id: s.shopify_product_id,
        shopify_variant_id: s.shopify_variant_id,
        arbeid_uren: String(s.arbeid_uren),
      },
    ]);
  }

  function addCustomRegel() {
    setRegels((prev) => [
      ...prev,
      {
        key: mkKey(),
        mode: "custom",
        naam: "Reparatie",
        onderdeel_naam: "",
        onderdeel_prijs_incl: "",
        arbeid_uren: "1",
      },
    ]);
  }

  async function submit() {
    setError(null);
    if (!naam.trim() || !volledigAdres) {
      setError("Naam en adres zijn verplicht.");
      return;
    }
    if (needsProducts && regels.length === 0) {
      setError("Voeg minstens één reparatieregel toe, of kies producten nog niet bekend.");
      return;
    }
    setSaving(true);
    try {
      const payloadRegels = needsProducts
        ? regels.map((r) =>
            r.mode === "standaard"
              ? { kind: "standaard" as const, standaard_id: r.standaard_id, naam: r.naam }
              : {
                  kind: "custom" as const,
                  naam: r.naam,
                  onderdeel_naam: r.onderdeel_naam || r.naam,
                  onderdeel_prijs_incl:
                    parseFloat(r.onderdeel_prijs_incl.replace(",", ".")) || 0,
                  shopify_product_id: r.shopify_product_id ?? null,
                  shopify_variant_id: r.shopify_variant_id ?? null,
                  arbeid_uren: parseFloat(r.arbeid_uren.replace(",", ".")) || 0,
                }
          )
        : [];

      const res = await fetch("/api/reparaties/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort,
          betaalwijze,
          producten_nog_niet_bekend: productenOnbekend && soort === "reparatie_deur",
          naam,
          email,
          telefoonnummer: telefoon,
          straatnaam: straat,
          huisnummer: huisnr,
          postcode,
          woonplaats,
          bezorgtijd_voorkeur: bezorgtijd,
          datum_voorkeur: datumVoorkeur,
          opmerking,
          regels: payloadRegels,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      router.push("/reparaties/gepland");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
          <div className="mb-6 flex items-center gap-4">
            <Link href="/reparaties" className="text-koopje-black/60 hover:text-koopje-black">
              ← Terug
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black">Reparatie aanmaken</h1>
          </div>

          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="space-y-6">
            <fieldset>
              <legend className="text-sm font-medium text-koopje-black">Type</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ["reparatie_deur", "Reparatie aan huis"],
                    ["reparatie_ophalen", "Ophalen"],
                    ["reparatie_terugbrengen", "Terugbrengen"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSoort(value);
                      if (value !== "reparatie_deur") setProductenOnbekend(false);
                    }}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      soort === value
                        ? "bg-koopje-orange text-white"
                        : "bg-stone-100 text-koopje-black"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-koopje-black">Betaling</legend>
              <div className="mt-2 flex gap-2">
                {(
                  [
                    ["factuur", "Factuur (Moneybird concept)"],
                    ["contant", "Contant (geen factuur)"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBetaalwijze(value)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      betaalwijze === value
                        ? "bg-koopje-orange text-white"
                        : "bg-stone-100 text-koopje-black"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block text-sm">
              Naam *
              <input
                className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              E-mail
              <input
                type="email"
                className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Telefoon
              <input
                className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5"
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
              />
            </label>

            <AdresAutocomplete
              velden={{
                straatnaam: straat,
                huisnummer: huisnr,
                postcode,
                woonplaats,
              }}
              onChange={(v) => {
                setStraat(v.straatnaam);
                setHuisnr(v.huisnummer);
                setPostcode(v.postcode);
                setWoonplaats(v.woonplaats);
              }}
            />

            <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-koopje-black/70">
              {voorrijLoading
                ? "Voorrijkosten berekenen…"
                : voorrij
                  ? `Afstand ≈ ${voorrij.km} km · Voorrijkosten €${voorrij.bedrag.toFixed(2)}`
                  : "Vul een adres in voor automatische voorrijkosten."}
            </div>

            <label className="block text-sm">
              Bezorgtijd voorkeur
              <input
                className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5"
                value={bezorgtijd}
                onChange={(e) => setBezorgtijd(e.target.value)}
                placeholder="bijv. na 14:00"
              />
            </label>
            <label className="block text-sm">
              Datum voorkeur
              <input
                className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5"
                value={datumVoorkeur}
                onChange={(e) => setDatumVoorkeur(e.target.value)}
                placeholder="datum of x voor vandaag"
              />
            </label>
            <label className="block text-sm">
              Opmerking
              <textarea
                className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2.5"
                rows={3}
                value={opmerking}
                onChange={(e) => setOpmerking(e.target.value)}
              />
            </label>

            {soort === "reparatie_deur" && (
              <section className="space-y-3 rounded-xl border border-koopje-black/10 p-4">
                <h2 className="text-sm font-medium text-koopje-black">Producten / arbeid</h2>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={productenOnbekend}
                    onChange={(e) => setProductenOnbekend(e.target.checked)}
                  />
                  Producten nog niet bekend
                </label>

                {!productenOnbekend && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="rounded-lg border border-koopje-black/20 px-2 py-1.5 text-sm"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            addStandaardRegel(e.target.value);
                            e.target.value = "";
                          }
                        }}
                      >
                        <option value="">+ Standaardreparatie…</option>
                        {standaard.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.naam}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={addCustomRegel}
                        className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-sm"
                      >
                        + Geen standaard (Shopify + uren)
                      </button>
                    </div>

                    {regels.map((r) => (
                      <div key={r.key} className="rounded-lg border border-stone-200 p-3 text-sm">
                        {r.mode === "standaard" ? (
                          <p>
                            <strong>{r.naam}</strong>
                            <span className="text-koopje-black/50">
                              {" "}
                              · onderdeel €{r.onderdeel_prijs_incl} · {r.arbeid_uren} u arbeid (€
                              {arbeidPrijsIncl(parseFloat(r.arbeid_uren) || 0).toFixed(2)})
                            </span>
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <ProductAutocomplete
                              label="Onderdeel (Shopify)"
                              value={r.onderdeel_naam}
                              searchSource="shopify"
                              onChange={(title, prijs, meta) => {
                                setRegels((prev) =>
                                  prev.map((x) =>
                                    x.key === r.key
                                      ? {
                                          ...x,
                                          onderdeel_naam: title,
                                          naam: title || x.naam,
                                          onderdeel_prijs_incl: prijs ?? x.onderdeel_prijs_incl,
                                          shopify_product_id: meta?.shopify_product_id ?? null,
                                          shopify_variant_id: meta?.shopify_variant_id ?? null,
                                        }
                                      : x
                                  )
                                );
                              }}
                            />
                            <label className="block text-xs">
                              Prijs onderdeel incl. 21%
                              <input
                                className="mt-0.5 w-full rounded border px-2 py-1.5"
                                value={r.onderdeel_prijs_incl}
                                onChange={(e) =>
                                  setRegels((prev) =>
                                    prev.map((x) =>
                                      x.key === r.key
                                        ? { ...x, onderdeel_prijs_incl: e.target.value }
                                        : x
                                    )
                                  )
                                }
                              />
                            </label>
                            <label className="block text-xs">
                              Arbeidsuren (× €{ARBEID_UUR_PRIJS_INCL} incl. 9%)
                              <input
                                className="mt-0.5 w-full rounded border px-2 py-1.5"
                                value={r.arbeid_uren}
                                onChange={(e) =>
                                  setRegels((prev) =>
                                    prev.map((x) =>
                                      x.key === r.key
                                        ? { ...x, arbeid_uren: e.target.value }
                                        : x
                                    )
                                  )
                                }
                              />
                            </label>
                          </div>
                        )}
                        <button
                          type="button"
                          className="mt-2 text-xs text-red-600"
                          onClick={() =>
                            setRegels((prev) => prev.filter((x) => x.key !== r.key))
                          }
                        >
                          Verwijderen
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </section>
            )}

            <p className="text-right text-sm font-medium text-koopje-black">
              Totaal ≈ €{totaal.toFixed(2)}
            </p>

            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="w-full rounded-xl bg-koopje-orange py-3 font-medium text-white disabled:opacity-50"
            >
              {saving ? "Bezig…" : "Order aanmaken"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
