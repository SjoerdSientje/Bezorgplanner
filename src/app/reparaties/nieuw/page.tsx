"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import AdresAutocomplete from "@/components/AdresAutocomplete";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import ArbeidUrenInput from "@/components/ArbeidUrenInput";
import {
  arbeidPrijsIncl,
  normalizeStandaardOnderdelen,
  reparatieSoortHeeftProducten,
  standaardReparatieTotaalIncl,
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
  const [fietsOokOpgehaald, setFietsOokOpgehaald] = useState(false);

  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [adres, setAdres] = useState({
    straatnaam: "",
    huisnummer: "",
    postcode: "",
    woonplaats: "",
  });
  const [bezorgtijd, setBezorgtijd] = useState("");
  const [datumVoorkeur, setDatumVoorkeur] = useState("");
  const [opmerking, setOpmerking] = useState("");

  const [standaard, setStandaard] = useState<ReparatieStandaardItem[]>([]);
  const [standaardLoading, setStandaardLoading] = useState(true);
  const [standaardError, setStandaardError] = useState<string | null>(null);
  const [regels, setRegels] = useState<DraftRegel[]>([]);
  const [voorrij, setVoorrij] = useState<{ km: number; bedrag: number } | null>(null);
  const [voorrijLoading, setVoorrijLoading] = useState(false);
  const [voorrijBedragStr, setVoorrijBedragStr] = useState("");
  const [voorrijManual, setVoorrijManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsProducts =
    soort === "reparatie_terugbrengen" ||
    (soort === "reparatie_deur" && !productenOnbekend);
  const showBetaling = soort !== "reparatie_ophalen";

  const loadStandaard = useCallback(async () => {
    setStandaardLoading(true);
    setStandaardError(null);
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/reparaties/prijslijst?t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Prijzenlijst laden mislukt"
          );
        }
        setStandaard(Array.isArray(data.items) ? data.items : []);
        setStandaardError(null);
        setStandaardLoading(false);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Prijzenlijst laden mislukt";
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }
    setStandaard([]);
    setStandaardError(lastError);
    setStandaardLoading(false);
  }, []);

  useEffect(() => {
    void loadStandaard();
  }, [loadStandaard]);

  const volledigAdres = useMemo(
    () =>
      [adres.straatnaam, adres.huisnummer, adres.postcode, adres.woonplaats]
        .filter(Boolean)
        .join(", ")
        .trim(),
    [adres]
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
    setVoorrijManual(false);
  }, [adres.straatnaam, adres.huisnummer, adres.postcode, adres.woonplaats]);

  useEffect(() => {
    const t = setTimeout(() => void refreshVoorrij(), 600);
    return () => clearTimeout(t);
  }, [refreshVoorrij]);

  const autoVoorrijTotaal =
    voorrij == null
      ? null
      : soort === "reparatie_terugbrengen" && fietsOokOpgehaald
        ? Math.round(voorrij.bedrag * 2 * 100) / 100
        : voorrij.bedrag;

  useEffect(() => {
    if (voorrijManual) return;
    if (autoVoorrijTotaal == null) {
      setVoorrijBedragStr("");
      return;
    }
    setVoorrijBedragStr(autoVoorrijTotaal.toFixed(2));
  }, [autoVoorrijTotaal, voorrijManual]);

  const voorrijTotaalParsed = (() => {
    const n = parseFloat(voorrijBedragStr.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  })();

  const voorrijWeergave =
    voorrij == null && voorrijTotaalParsed == null
      ? null
      : {
          km: voorrij?.km ?? null,
          bedrag: voorrijTotaalParsed ?? autoVoorrijTotaal ?? 0,
          basis:
            soort === "reparatie_terugbrengen" && fietsOokOpgehaald
              ? Math.round(((voorrijTotaalParsed ?? autoVoorrijTotaal ?? 0) / 2) * 100) /
                100
              : (voorrijTotaalParsed ?? autoVoorrijTotaal ?? 0),
        };

  const subtotaalRegels = useMemo(() => {
    if (!needsProducts) return 0;
    return regels.reduce((sum, r) => {
      const prijs = parseFloat(r.onderdeel_prijs_incl.replace(",", ".")) || 0;
      const uren = parseFloat(r.arbeid_uren.replace(",", ".")) || 0;
      return sum + prijs + arbeidPrijsIncl(uren);
    }, 0);
  }, [regels, needsProducts]);

  const totaal = subtotaalRegels + (voorrijWeergave?.bedrag ?? 0);

  function addStandaardRegel(id: string) {
    const s = standaard.find((i) => i.id === id);
    if (!s) return;
    const onderdelen = normalizeStandaardOnderdelen(s);
    const prijs = onderdelen.reduce((sum, o) => sum + (o.prijs_incl || 0), 0);
    setRegels((prev) => [
      ...prev,
      {
        key: mkKey(),
        mode: "standaard",
        standaard_id: s.id,
        naam: s.naam,
        onderdeel_naam: onderdelen.map((o) => o.naam).join(" + ") || s.naam,
        onderdeel_prijs_incl: String(prijs),
        shopify_product_id: onderdelen[0]?.shopify_product_id ?? null,
        shopify_variant_id: onderdelen[0]?.shopify_variant_id ?? null,
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
      setError(
        soort === "reparatie_deur"
          ? "Voeg minstens één reparatieregel toe, of kies producten nog niet bekend."
          : "Voeg minstens één reparatieregel toe."
      );
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
          betaalwijze: soort === "reparatie_ophalen" ? "contant" : betaalwijze,
          producten_nog_niet_bekend:
            productenOnbekend && soort === "reparatie_deur",
          fiets_ook_opgehaald:
            soort === "reparatie_terugbrengen" && fietsOokOpgehaald,
          naam,
          email,
          telefoonnummer: telefoon,
          straatnaam: adres.straatnaam,
          huisnummer: adres.huisnummer,
          postcode: adres.postcode,
          woonplaats: adres.woonplaats,
          bezorgtijd_voorkeur: bezorgtijd,
          datum_voorkeur: datumVoorkeur,
          opmerking,
          regels: payloadRegels,
          voorrij_bedrag: voorrijTotaalParsed ?? 0,
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
                      if (value !== "reparatie_deur") {
                        setProductenOnbekend(false);
                      }
                      if (value !== "reparatie_terugbrengen") {
                        setFietsOokOpgehaald(false);
                      }
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

            {showBetaling && (
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
            )}

            {soort === "reparatie_ophalen" && (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-koopje-black/60">
                Ophalen-orders krijgen geen factuur.
              </p>
            )}

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
              velden={adres}
              onChange={(v) =>
                setAdres({
                  straatnaam: v.straatnaam,
                  huisnummer: v.huisnummer,
                  postcode: v.postcode,
                  woonplaats: v.woonplaats,
                })
              }
            />

            <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-koopje-black/70">
              {voorrijLoading ? (
                "Voorrijkosten berekenen…"
              ) : voorrijWeergave ? (
                <div className="flex flex-wrap items-end gap-3">
                  <p className="min-w-0 flex-1">
                    {voorrijWeergave.km != null
                      ? `Afstand ≈ ${voorrijWeergave.km} km`
                      : "Afstand onbekend"}
                    {soort === "reparatie_terugbrengen" && fietsOokOpgehaald
                      ? " · ophalen + terugbrengen"
                      : ""}
                    {voorrijManual ? " · handmatig aangepast" : ""}
                  </p>
                  <label className="flex items-center gap-1.5 text-sm text-koopje-black">
                    <span className="whitespace-nowrap">Voorrijkosten €</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={voorrijBedragStr}
                      onChange={(e) => {
                        setVoorrijManual(true);
                        setVoorrijBedragStr(e.target.value);
                      }}
                      className="w-24 rounded-lg border border-koopje-black/20 bg-white px-2 py-1.5 text-sm font-medium"
                      aria-label="Voorrijkosten bedrag"
                    />
                  </label>
                </div>
              ) : (
                "Vul een adres in voor automatische voorrijkosten."
              )}
            </div>

            {soort === "reparatie_terugbrengen" && (
              <label className="flex items-start gap-2 rounded-xl border border-koopje-orange/30 bg-koopje-orange-light/30 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={fietsOokOpgehaald}
                  onChange={(e) => setFietsOokOpgehaald(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-koopje-black">Fiets is ook opgehaald</span>
                  <span className="mt-0.5 block text-koopje-black/60">
                    Voorrijkosten ×2 op de factuur (ophalen + terugbrengen).
                  </span>
                </span>
              </label>
            )}

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

            {reparatieSoortHeeftProducten(soort) && (
              <section className="space-y-3 rounded-xl border border-koopje-black/10 p-4">
                <h2 className="text-sm font-medium text-koopje-black">Producten / arbeid</h2>
                {soort === "reparatie_deur" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={productenOnbekend}
                      onChange={(e) => setProductenOnbekend(e.target.checked)}
                    />
                    Producten nog niet bekend
                  </label>
                )}

                {(soort === "reparatie_terugbrengen" || !productenOnbekend) && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        key={`standaard-${standaard.map((s) => s.id).join("-") || "leeg"}`}
                        className="rounded-lg border border-koopje-black/20 px-2 py-1.5 text-sm"
                        defaultValue=""
                        disabled={standaardLoading || standaard.length === 0}
                        onChange={(e) => {
                          if (e.target.value) {
                            addStandaardRegel(e.target.value);
                            e.target.value = "";
                          }
                        }}
                      >
                        <option value="">
                          {standaardLoading
                            ? "Standaardreparaties laden…"
                            : standaard.length === 0
                              ? "Geen standaardreparaties"
                              : "+ Standaardreparatie…"}
                        </option>
                        {standaard.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.naam} — €{standaardReparatieTotaalIncl(s).toFixed(2)}
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
                      {(standaardError || (!standaardLoading && standaard.length === 0)) && (
                        <button
                          type="button"
                          onClick={() => void loadStandaard()}
                          className="text-xs text-koopje-orange hover:underline"
                        >
                          Opnieuw laden
                        </button>
                      )}
                    </div>
                    {standaardError && (
                      <p className="text-xs text-red-600">{standaardError}</p>
                    )}

                    {regels.map((r) => (
                      <div key={r.key} className="rounded-lg border border-stone-200 p-3 text-sm">
                        {r.mode === "standaard" ? (
                          <p>
                            <strong>{r.naam}</strong>
                            <span className="text-koopje-black/50">
                              {" "}
                              · {r.onderdeel_naam || "onderdelen"} (€{r.onderdeel_prijs_incl}) ·{" "}
                              {r.arbeid_uren} u arbeid (€
                              {arbeidPrijsIncl(parseFloat(r.arbeid_uren) || 0).toFixed(2)})
                            </span>
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <ProductAutocomplete
                              label="Onderdeel (Shopify)"
                              value={r.onderdeel_naam}
                              searchSource="shopify"
                              productKind="extra"
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
                            <ArbeidUrenInput
                              compact
                              uren={r.arbeid_uren}
                              onUrenChange={(u) =>
                                setRegels((prev) =>
                                  prev.map((x) =>
                                    x.key === r.key ? { ...x, arbeid_uren: u } : x
                                  )
                                )
                              }
                            />
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
