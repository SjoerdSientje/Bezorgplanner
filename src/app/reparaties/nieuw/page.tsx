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
  buildReparatieProductenKolom,
  normalizeStandaardOnderdelen,
  reparatieSoortHeeftProducten,
  reparatieSoortProductenPrefix,
  standaardReparatieTotaalIncl,
  type ReparatieBetaalwijze,
  type ReparatieOnderdeel,
  type ReparatieSoort,
  type ReparatieStandaardItem,
} from "@/lib/reparaties";

type RegelMode = "standaard" | "custom";

type DraftOnderdeel = {
  key: string;
  naam: string;
  prijs_incl: string;
  shopify_product_id?: number | null;
  shopify_variant_id?: number | null;
};

type DraftRegel = {
  key: string;
  mode: RegelMode;
  standaard_id?: string;
  /** Titel standaardreparatie of custom-label. */
  naam: string;
  onderdelen: DraftOnderdeel[];
  arbeid_uren: string;
};

function mkKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function patchRegel(
  prev: DraftRegel[],
  key: string,
  patch: Partial<DraftRegel>
): DraftRegel[] {
  return prev.map((x) => (x.key === key ? { ...x, ...patch } : x));
}

export default function ReparatieNieuwPage() {
  const router = useRouter();
  const [soort, setSoort] = useState<ReparatieSoort>("reparatie_deur");
  const [betaalwijze, setBetaalwijze] = useState<ReparatieBetaalwijze>("factuur");
  const [vrijeTekstModus, setVrijeTekstModus] = useState(false);
  const [vrijeTekst, setVrijeTekst] = useState("");
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
  const [productenKolomTekst, setProductenKolomTekst] = useState("");
  const [voorrij, setVoorrij] = useState<{ km: number; bedrag: number } | null>(null);
  const [voorrijLoading, setVoorrijLoading] = useState(false);
  const [voorrijBedragStr, setVoorrijBedragStr] = useState("");
  const [voorrijManual, setVoorrijManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsProducts =
    soort === "reparatie_terugbrengen" ||
    (soort === "reparatie_deur" && !vrijeTekstModus);
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

  const arbeidUrenTotaal = useMemo(() => {
    if (!needsProducts) return 0;
    return regels.reduce(
      (sum, r) => sum + (parseFloat(r.arbeid_uren.replace(",", ".")) || 0),
      0
    );
  }, [regels, needsProducts]);

  const arbeidUrenTotaalStr = useMemo(() => {
    if (arbeidUrenTotaal <= 0) return "";
    return String(Math.round(arbeidUrenTotaal * 10000) / 10000);
  }, [arbeidUrenTotaal]);

  const subtotaalRegels = useMemo(() => {
    if (!needsProducts) return 0;
    const producten = regels.reduce((sum, r) => {
      return (
        sum +
        r.onderdelen.reduce(
          (s, o) => s + (parseFloat(o.prijs_incl.replace(",", ".")) || 0),
          0
        )
      );
    }, 0);
    return producten + arbeidPrijsIncl(arbeidUrenTotaal);
  }, [regels, needsProducts, arbeidUrenTotaal]);

  const totaal = subtotaalRegels + (voorrijWeergave?.bedrag ?? 0);

  const defaultProductenKolom = useMemo(() => {
    if (!needsProducts) return "";
    return buildReparatieProductenKolom({
      soort,
      regels: regels.map((r) => ({
        naam: r.naam,
        onderdeel_naam: r.onderdelen.map((o) => o.naam).filter(Boolean).join(" + "),
      })),
    });
  }, [needsProducts, soort, regels]);

  function setArbeidUrenTotaal(uren: string) {
    setRegels((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((r, i) =>
        i === 0 ? { ...r, arbeid_uren: uren } : { ...r, arbeid_uren: "0" }
      );
    });
  }

  function addStandaardRegel(id: string) {
    const s = standaard.find((i) => i.id === id);
    if (!s) return;
    const onderdelen = normalizeStandaardOnderdelen(s);
    setRegels((prev) => [
      ...prev,
      {
        key: mkKey(),
        mode: "standaard",
        standaard_id: s.id,
        naam: s.naam,
        onderdelen: (onderdelen.length
          ? onderdelen
          : [{ naam: s.naam, prijs_incl: 0 } as ReparatieOnderdeel]
        ).map((o) => ({
          key: mkKey(),
          naam: o.naam,
          prijs_incl: String(o.prijs_incl ?? 0),
          shopify_product_id: o.shopify_product_id ?? null,
          shopify_variant_id: o.shopify_variant_id ?? null,
        })),
        arbeid_uren: String(s.arbeid_uren ?? 0),
      },
    ]);
  }

  function addCustomRegel() {
    setRegels((prev) => [
      ...prev,
      {
        key: mkKey(),
        mode: "custom",
        naam: "",
        onderdelen: [
          {
            key: mkKey(),
            naam: "",
            prijs_incl: "",
            shopify_product_id: null,
            shopify_variant_id: null,
          },
        ],
        arbeid_uren: prev.length === 0 ? "1" : "0",
      },
    ]);
  }

  function removeRegel(key: string) {
    setRegels((prev) => {
      const victim = prev.find((r) => r.key === key);
      const rest = prev.filter((r) => r.key !== key);
      if (!victim || rest.length === 0) return rest;
      const victimUren = parseFloat(victim.arbeid_uren.replace(",", ".")) || 0;
      if (victimUren <= 0) return rest;
      const othersHaveUren = rest.some(
        (r) => (parseFloat(r.arbeid_uren.replace(",", ".")) || 0) > 0
      );
      if (othersHaveUren) return rest;
      // Geconsolideerde uren stonden op deze regel → verplaats naar de eerste resterende.
      return rest.map((r, i) =>
        i === 0 ? { ...r, arbeid_uren: victim.arbeid_uren } : r
      );
    });
  }

  function patchOnderdeel(
    regelKey: string,
    onderdeelKey: string,
    patch: Partial<DraftOnderdeel>
  ) {
    setRegels((prev) =>
      prev.map((r) =>
        r.key !== regelKey
          ? r
          : {
              ...r,
              onderdelen: r.onderdelen.map((o) =>
                o.key === onderdeelKey ? { ...o, ...patch } : o
              ),
              ...(patch.naam != null && r.mode === "custom"
                ? { naam: patch.naam || r.naam }
                : {}),
            }
      )
    );
  }

  function toggleFietsOokOpgehaald(checked: boolean) {
    if (voorrijManual) {
      const current = parseFloat(voorrijBedragStr.replace(",", "."));
      if (Number.isFinite(current) && current >= 0) {
        const next = checked
          ? Math.round(current * 2 * 100) / 100
          : Math.round((current / 2) * 100) / 100;
        setVoorrijBedragStr(next.toFixed(2));
      }
    }
    setFietsOokOpgehaald(checked);
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
          ? "Voeg minstens één reparatieregel toe, of kies vul vrije tekst."
          : "Voeg minstens één reparatieregel toe."
      );
      return;
    }
    if (soort === "reparatie_deur" && vrijeTekstModus && !vrijeTekst.trim()) {
      setError("Vul vrije tekst in voor de productenkolom.");
      return;
    }
    setSaving(true);
    try {
      const payloadRegels = needsProducts
        ? regels.map((r) => {
            const onderdelen = r.onderdelen
              .filter((o) => o.naam.trim())
              .map((o) => ({
                naam: o.naam.trim(),
                prijs_incl: parseFloat(o.prijs_incl.replace(",", ".")) || 0,
                shopify_product_id: o.shopify_product_id ?? null,
                shopify_variant_id: o.shopify_variant_id ?? null,
              }));
            const onderdeelPrijs = onderdelen.reduce(
              (s, o) => s + o.prijs_incl,
              0
            );
            if (r.mode === "standaard") {
              return {
                kind: "standaard" as const,
                standaard_id: r.standaard_id,
                naam: r.naam,
                onderdeel_prijs_incl: onderdeelPrijs,
                onderdelen,
                arbeid_uren: parseFloat(r.arbeid_uren.replace(",", ".")) || 0,
              };
            }
            const first = onderdelen[0];
            return {
              kind: "custom" as const,
              naam: r.naam || first?.naam || "Reparatie",
              onderdeel_naam: first?.naam || r.naam || "Reparatie",
              onderdeel_prijs_incl: first?.prijs_incl ?? 0,
              shopify_product_id: first?.shopify_product_id ?? null,
              shopify_variant_id: first?.shopify_variant_id ?? null,
              onderdelen,
              arbeid_uren: parseFloat(r.arbeid_uren.replace(",", ".")) || 0,
            };
          })
        : [];

      const res = await fetch("/api/reparaties/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort,
          betaalwijze: soort === "reparatie_ophalen" ? "contant" : betaalwijze,
          producten_nog_niet_bekend:
            vrijeTekstModus && soort === "reparatie_deur",
          producten_vrije_tekst:
            soort === "reparatie_ophalen"
              ? vrijeTekst.trim()
              : vrijeTekstModus && soort === "reparatie_deur"
                ? vrijeTekst.trim()
                : undefined,
          producten_kolom_tekst:
            !vrijeTekstModus && needsProducts
              ? productenKolomTekst.trim() || undefined
              : undefined,
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
                        setVrijeTekstModus(false);
                        setVrijeTekst("");
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
                      [
                        "factuur",
                        soort === "reparatie_terugbrengen"
                          ? "Factuur (wordt meteen verstuurd)"
                          : "Factuur (concept tot afronden)",
                      ],
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

            {voorrijLoading ? (
              <p className="text-sm text-koopje-black/50">Voorrijkosten berekenen…</p>
            ) : voorrijWeergave?.km != null ? (
              <p className="text-sm text-koopje-black/60">
                Afstand ≈ {voorrijWeergave.km} km
                {soort === "reparatie_terugbrengen" && fietsOokOpgehaald
                  ? " · ophalen + terugbrengen"
                  : ""}
                {voorrijManual ? " · voorrijkosten handmatig" : ""}
              </p>
            ) : null}

            {soort === "reparatie_terugbrengen" && (
              <label className="flex items-start gap-2 rounded-xl border border-koopje-orange/30 bg-koopje-orange-light/30 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={fietsOokOpgehaald}
                  onChange={(e) => toggleFietsOokOpgehaald(e.target.checked)}
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

            {soort === "reparatie_ophalen" && (
              <label className="block text-sm">
                Productenkolom
                <div className="mt-1 flex overflow-hidden rounded-xl border border-koopje-black/20 focus-within:ring-2 focus-within:ring-koopje-orange/40">
                  <span className="shrink-0 select-none border-r border-koopje-black/10 bg-stone-50 px-3 py-2.5 text-sm text-koopje-black/70">
                    Ophalen:
                  </span>
                  <input
                    className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none"
                    value={vrijeTekst}
                    onChange={(e) =>
                      setVrijeTekst(e.target.value.replace(/^ophalen:\s*/i, ""))
                    }
                    placeholder="optioneel, bijv. kapotte band"
                  />
                </div>
              </label>
            )}

            {reparatieSoortHeeftProducten(soort) && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-koopje-black">
                    Factuur (concept)
                  </h2>
                  {soort === "reparatie_deur" && (
                    <label className="flex items-center gap-2 text-sm text-koopje-black/70">
                      <input
                        type="checkbox"
                        checked={vrijeTekstModus}
                        onChange={(e) => {
                          setVrijeTekstModus(e.target.checked);
                          if (e.target.checked) setRegels([]);
                        }}
                      />
                      Alleen vrije tekst
                    </label>
                  )}
                </div>

                {vrijeTekstModus && soort === "reparatie_deur" ? (
                  <label className="block text-sm">
                    Productenkolom
                    <div className="mt-1 flex overflow-hidden rounded-xl border border-koopje-black/20">
                      <span className="shrink-0 select-none border-r border-koopje-black/10 bg-stone-50 px-3 py-2.5 text-sm text-koopje-black/70">
                        {reparatieSoortProductenPrefix(soort)}
                      </span>
                      <input
                        className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none"
                        value={vrijeTekst}
                        onChange={(e) => setVrijeTekst(e.target.value)}
                        placeholder="bijv. band plakken / diagnose"
                      />
                    </div>
                  </label>
                ) : (
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
                        + Shopify-product
                      </button>
                      {(standaardError ||
                        (!standaardLoading && standaard.length === 0)) && (
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

                    <div className="overflow-hidden rounded-xl border border-koopje-black/15 bg-white shadow-sm">
                      <div className="border-b border-koopje-black/10 bg-stone-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-koopje-black/50">
                        Simulatiefactuur
                      </div>
                      <ul className="divide-y divide-stone-100">
                        {regels.length === 0 && (
                          <li className="px-4 py-6 text-center text-sm text-koopje-black/40">
                            Voeg een standaardreparatie of Shopify-product toe
                          </li>
                        )}
                        {regels.map((r) => (
                          <li key={r.key} className="space-y-2 px-4 py-3">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-medium text-koopje-black/50">
                                {r.mode === "standaard"
                                  ? r.naam || "Standaardreparatie"
                                  : "Shopify-product"}
                              </p>
                              <button
                                type="button"
                                className="text-xs text-red-600 hover:underline"
                                onClick={() => removeRegel(r.key)}
                              >
                                Verwijderen
                              </button>
                            </div>
                            {r.mode === "custom" && !r.onderdelen[0]?.naam ? (
                              <ProductAutocomplete
                                label="Product zoeken"
                                value={r.onderdelen[0]?.naam ?? ""}
                                searchSource="shopify"
                                productKind="extra"
                                onChange={(title, prijs, meta) => {
                                  const oKey = r.onderdelen[0]?.key;
                                  if (!oKey) return;
                                  patchOnderdeel(r.key, oKey, {
                                    naam: title,
                                    ...(prijs != null ? { prijs_incl: prijs } : {}),
                                    ...(meta !== undefined
                                      ? {
                                          shopify_product_id:
                                            meta.shopify_product_id ?? null,
                                          shopify_variant_id:
                                            meta.shopify_variant_id ?? null,
                                        }
                                      : {}),
                                  });
                                  setRegels((prev) =>
                                    patchRegel(prev, r.key, {
                                      naam: title || "Reparatie",
                                    })
                                  );
                                }}
                              />
                            ) : (
                              r.onderdelen.map((o) => (
                                <div
                                  key={o.key}
                                  className="flex items-center gap-3 text-sm"
                                >
                                  <span className="min-w-0 flex-1 text-koopje-black">
                                    {o.naam || "—"}
                                  </span>
                                  <label className="flex items-center gap-1 text-xs text-koopje-black/50">
                                    €
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className="w-20 rounded border border-koopje-black/15 px-2 py-1 text-sm text-koopje-black"
                                      value={o.prijs_incl}
                                      onChange={(e) =>
                                        patchOnderdeel(r.key, o.key, {
                                          prijs_incl: e.target.value,
                                        })
                                      }
                                      aria-label={`Prijs ${o.naam}`}
                                    />
                                  </label>
                                </div>
                              ))
                            )}
                          </li>
                        ))}

                        {(regels.length > 0 || arbeidUrenTotaal > 0) && (
                          <li className="space-y-2 bg-stone-50/60 px-4 py-3">
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="font-medium text-koopje-black">
                                Arbeidskosten
                              </span>
                              <span className="tabular-nums text-koopje-black">
                                €{arbeidPrijsIncl(arbeidUrenTotaal).toFixed(2)}
                              </span>
                            </div>
                            <ArbeidUrenInput
                              compact
                              uren={arbeidUrenTotaalStr}
                              onUrenChange={setArbeidUrenTotaal}
                            />
                          </li>
                        )}

                        <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <div>
                            <p className="font-medium text-koopje-black">
                              Voorrijkosten
                            </p>
                            {voorrijLoading && (
                              <p className="text-xs text-koopje-black/40">
                                Berekenen…
                              </p>
                            )}
                          </div>
                          <label className="flex items-center gap-1 text-xs text-koopje-black/50">
                            €
                            <input
                              type="text"
                              inputMode="decimal"
                              className="w-24 rounded border border-koopje-black/15 px-2 py-1 text-sm font-medium text-koopje-black"
                              value={voorrijBedragStr}
                              onChange={(e) => {
                                setVoorrijManual(true);
                                setVoorrijBedragStr(e.target.value);
                              }}
                              aria-label="Voorrijkosten"
                            />
                          </label>
                        </li>
                      </ul>
                      <div className="flex items-center justify-between border-t border-koopje-black/10 bg-stone-50 px-4 py-3 text-sm font-semibold text-koopje-black">
                        <span>Totaal</span>
                        <span className="tabular-nums">€{totaal.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-xl border border-koopje-black/10 bg-stone-50/40 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                        Productenkolom (standaard)
                      </p>
                      <p className="rounded-lg border border-dashed border-koopje-black/15 bg-white px-3 py-2 text-sm text-koopje-black">
                        {defaultProductenKolom ||
                          `${reparatieSoortProductenPrefix(soort)} …`}
                      </p>
                      <label className="block text-sm text-koopje-black/70">
                        Optioneel: andere tekst in productenkolom
                        <div className="mt-1 flex overflow-hidden rounded-xl border border-koopje-black/20 bg-white">
                          <span className="shrink-0 select-none border-r border-koopje-black/10 bg-stone-50 px-3 py-2.5 text-sm text-koopje-black/70">
                            {reparatieSoortProductenPrefix(soort)}
                          </span>
                          <input
                            className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none"
                            value={productenKolomTekst}
                            onChange={(e) =>
                              setProductenKolomTekst(
                                e.target.value.replace(
                                  /^(reparatie aan huis|terugbrengen):\s*/i,
                                  ""
                                )
                              )
                            }
                            placeholder="leeg = standaard hierboven"
                          />
                        </div>
                      </label>
                    </div>
                  </>
                )}
              </section>
            )}

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
