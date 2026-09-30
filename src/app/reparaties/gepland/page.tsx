"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import AdresAutocomplete from "@/components/AdresAutocomplete";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import ArbeidUrenInput from "@/components/ArbeidUrenInput";
import {
  arbeidPrijsIncl,
  normalizeStandaardOnderdelen,
  parseStoredReparatieRegels,
  reparatieSoortHeeftProducten,
  reparatieSoortLabel,
  type ReparatieBetaalwijze,
  type ReparatieSoort,
  type ReparatieStandaardItem,
} from "@/lib/reparaties";

type OrderRow = {
  id: string;
  order_nummer: string | null;
  type: string;
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
  reparatie_betaalwijze: ReparatieBetaalwijze | null;
  producten_nog_niet_bekend: boolean;
  fiets_ook_opgehaald?: boolean;
  voorrij_km: number | null;
  voorrij_bedrag: number | null;
  reparatie_regels_json?: unknown;
};

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

type EditDraft = {
  id: string;
  soort: ReparatieSoort;
  /** null = nog kiezen (bijv. na switch weg van ophalen). */
  betaalwijze: ReparatieBetaalwijze | null;
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
  producten_nog_niet_bekend: boolean;
  fiets_ook_opgehaald: boolean;
  regels: DraftRegel[];
};

function mkKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function splitAdres(volledig: string): {
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
} {
  const parts = volledig.trim().split(/\s+/).filter(Boolean);
  const postcodeIdx = parts.findIndex(
    (p) => /^\d{4}\s*[A-Za-z]{2}$/i.test(p) || /^\d{4}$/.test(p)
  );
  if (postcodeIdx < 0) {
    return { straatnaam: volledig.trim(), huisnummer: "", postcode: "", woonplaats: "" };
  }
  let postcode = parts[postcodeIdx] ?? "";
  let woonplaats = "";
  if (parts[postcodeIdx + 1] && /^[A-Za-z]{2}$/i.test(parts[postcodeIdx + 1]!)) {
    postcode = `${parts[postcodeIdx]} ${parts[postcodeIdx + 1]}`;
    woonplaats = parts.slice(postcodeIdx + 2).join(" ");
  } else {
    woonplaats = parts.slice(postcodeIdx + 1).join(" ");
  }
  const before = parts.slice(0, postcodeIdx);
  const huisnummer = before[before.length - 1] ?? "";
  const straatnaam = before.slice(0, -1).join(" ") || before.join(" ");
  return { straatnaam, huisnummer, postcode, woonplaats };
}

function storedToDraft(raw: unknown): DraftRegel[] {
  return parseStoredReparatieRegels(raw).map((r) => ({
    key: mkKey(),
    mode: r.kind === "standaard" ? ("standaard" as const) : ("custom" as const),
    standaard_id: r.standaard_id ?? undefined,
    naam: r.naam,
    onderdeel_naam: r.onderdeel_naam || r.naam,
    onderdeel_prijs_incl: String(r.onderdeel_prijs_incl ?? 0),
    shopify_product_id: r.shopify_product_id ?? null,
    shopify_variant_id: r.shopify_variant_id ?? null,
    arbeid_uren: String(r.arbeid_uren ?? 0),
  }));
}

export default function ReparatiesGeplandPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [standaard, setStandaard] = useState<ReparatieStandaardItem[]>([]);
  const [standaardLoading, setStandaardLoading] = useState(true);
  const [standaardError, setStandaardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voorrij, setVoorrij] = useState<{ km: number; bedrag: number } | null>(null);
  const [voorrijLoading, setVoorrijLoading] = useState(false);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reparaties/order");
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
    void loadStandaard();
  }, [load, loadStandaard]);

  const volledigAdres = useMemo(() => {
    if (!edit) return "";
    return [edit.straatnaam, edit.huisnummer, edit.postcode, edit.woonplaats]
      .filter(Boolean)
      .join(" ")
      .trim();
  }, [edit]);

  useEffect(() => {
    if (!edit || volledigAdres.length < 8) {
      setVoorrij(null);
      return;
    }
    const t = setTimeout(() => {
      setVoorrijLoading(true);
      void fetch("/api/reparaties/voorrijkosten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adres: volledigAdres }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.km != null) setVoorrij({ km: d.km, bedrag: d.bedrag });
          else setVoorrij(null);
        })
        .catch(() => setVoorrij(null))
        .finally(() => setVoorrijLoading(false));
    }, 600);
    return () => clearTimeout(t);
  }, [edit, volledigAdres]);

  async function deleteOrder(o: OrderRow) {
    const label = o.order_nummer || o.naam || "deze order";
    const factuurHint =
      o.reparatie_betaalwijze === "factuur"
        ? " Eventuele conceptfactuur wordt ook verwijderd."
        : "";
    if (
      !confirm(
        `Order ${label} definitief verwijderen?\n\nDit haalt de order uit ritjes/gepland.${factuurHint}\nDit kan niet ongedaan worden gemaakt.`
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

  function startEdit(o: OrderRow) {
    const adres = splitAdres(o.volledig_adres ?? "");
    const soort = o.type as ReparatieSoort;
    setEdit({
      id: o.id,
      soort,
      betaalwijze:
        soort === "reparatie_ophalen"
          ? "contant"
          : (o.reparatie_betaalwijze as ReparatieBetaalwijze) || "factuur",
      naam: o.naam ?? "",
      email: o.email ?? "",
      telefoonnummer: o.telefoon_nummer ?? "",
      straatnaam: adres.straatnaam,
      huisnummer: adres.huisnummer,
      postcode: adres.postcode,
      woonplaats: adres.woonplaats,
      bezorgtijd_voorkeur: o.bezorgtijd_voorkeur ?? "",
      datum_voorkeur: o.datum_opmerking ?? "",
      opmerking: o.opmerkingen_klant ?? "",
      producten_nog_niet_bekend:
        soort === "reparatie_deur" && Boolean(o.producten_nog_niet_bekend),
      fiets_ook_opgehaald:
        soort === "reparatie_terugbrengen" && Boolean(o.fiets_ook_opgehaald),
      regels: storedToDraft(o.reparatie_regels_json),
    });
    if (o.voorrij_km != null && o.voorrij_bedrag != null) {
      // Voorrij-API geeft basisbedrag; als ×2 was opgeslagen, toon basis voor preview.
      const total = Number(o.voorrij_bedrag);
      const basis =
        o.fiets_ook_opgehaald && total > 0
          ? Math.round((total / 2) * 100) / 100
          : total;
      setVoorrij({ km: Number(o.voorrij_km), bedrag: basis });
    } else {
      setVoorrij(null);
    }
    setConfirmOpen(false);
  }

  function addStandaardRegel(id: string) {
    if (!edit) return;
    const s = standaard.find((i) => i.id === id);
    if (!s) return;
    const onderdelen = normalizeStandaardOnderdelen(s);
    const prijs = onderdelen.reduce((sum, o) => sum + (o.prijs_incl || 0), 0);
    setEdit({
      ...edit,
      regels: [
        ...edit.regels,
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
      ],
    });
  }

  function addCustomRegel() {
    if (!edit) return;
    setEdit({
      ...edit,
      regels: [
        ...edit.regels,
        {
          key: mkKey(),
          mode: "custom",
          naam: "Reparatie",
          onderdeel_naam: "",
          onderdeel_prijs_incl: "",
          arbeid_uren: "1",
        },
      ],
    });
  }

  const needsProducts =
    edit != null &&
    (edit.soort === "reparatie_terugbrengen" ||
      (edit.soort === "reparatie_deur" && !edit.producten_nog_niet_bekend));

  const voorrijWeergave =
    !edit || !voorrij
      ? null
      : edit.soort === "reparatie_terugbrengen" && edit.fiets_ook_opgehaald
        ? {
            km: voorrij.km,
            bedrag: Math.round(voorrij.bedrag * 2 * 100) / 100,
            basis: voorrij.bedrag,
          }
        : { km: voorrij.km, bedrag: voorrij.bedrag, basis: voorrij.bedrag };

  const subtotaal = useMemo(() => {
    if (!edit || !needsProducts) return 0;
    return edit.regels.reduce((sum, r) => {
      const prijs = parseFloat(r.onderdeel_prijs_incl.replace(",", ".")) || 0;
      const uren = parseFloat(r.arbeid_uren.replace(",", ".")) || 0;
      return sum + prijs + arbeidPrijsIncl(uren);
    }, 0);
  }, [edit, needsProducts]);

  async function doSave() {
    if (!edit) return;
    if (edit.soort !== "reparatie_ophalen" && !edit.betaalwijze) {
      setError("Kies contant of factuur.");
      setConfirmOpen(false);
      return;
    }
    if (needsProducts && edit.regels.length === 0) {
      setError(
        edit.soort === "reparatie_deur"
          ? "Voeg minstens één reparatieregel toe, of vink producten nog niet bekend aan."
          : "Voeg minstens één reparatieregel toe."
      );
      setConfirmOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payloadRegels = needsProducts
        ? edit.regels.map((r) =>
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
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: edit.id,
          soort: edit.soort,
          betaalwijze:
            edit.soort === "reparatie_ophalen" ? "contant" : edit.betaalwijze,
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
          producten_nog_niet_bekend:
            edit.soort === "reparatie_deur" && edit.producten_nog_niet_bekend,
          fiets_ook_opgehaald:
            edit.soort === "reparatie_terugbrengen" && edit.fiets_ook_opgehaald,
          regels: payloadRegels,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setEdit(null);
      setConfirmOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
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
            <h1 className="text-xl font-semibold text-koopje-black">Geplande reparaties</h1>
          </div>

          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          {loading && <p className="text-sm text-koopje-black/50">Laden…</p>}

          {!loading && orders.length === 0 && (
            <p className="text-sm text-koopje-black/60">Geen openstaande reparaties.</p>
          )}

          <ul className="space-y-3">
            {orders.map((o) => (
              <li
                key={o.id}
                className="rounded-xl border border-koopje-black/10 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-koopje-black">
                      {o.order_nummer} · {reparatieSoortLabel(o.type as ReparatieSoort)}
                    </p>
                    <p className="text-sm text-koopje-black/70">{o.naam}</p>
                    <p className="text-sm text-koopje-black/50">{o.volledig_adres}</p>
                    <p className="mt-1 text-xs text-koopje-black/50">
                      {o.type === "reparatie_ophalen"
                        ? "Geen factuur"
                        : o.reparatie_betaalwijze === "contant"
                          ? "Contant"
                          : "Factuur"}
                      {" · "}€{Number(o.bestelling_totaal_prijs ?? 0).toFixed(2)}
                      {o.producten_nog_niet_bekend ? " · producten onbekend" : ""}
                      {o.fiets_ook_opgehaald ? " · ook opgehaald" : ""}
                      {" · "}
                      {o.status}
                    </p>
                    {o.producten && (
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-koopje-black/60">
                        {o.producten}
                      </pre>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(o)}
                      className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-sm"
                    >
                      Bewerken
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteOrder(o)}
                      disabled={saving}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Verwijderen
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {edit && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
              <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
                <h2 className="text-lg font-semibold text-koopje-black">Reparatie bewerken</h2>
                <div className="mt-4 space-y-3 text-sm">
                  <label className="block">
                    Type
                    <select
                      className="mt-1 w-full rounded border px-2 py-2"
                      value={edit.soort}
                      onChange={(e) => {
                        const soort = e.target.value as ReparatieSoort;
                        const wasOphalen = edit.soort === "reparatie_ophalen";
                        setEdit({
                          ...edit,
                          soort,
                          // Ophalen: geen factuur. Weg van ophalen → opnieuw kiezen.
                          betaalwijze:
                            soort === "reparatie_ophalen"
                              ? "contant"
                              : wasOphalen
                                ? null
                                : edit.betaalwijze,
                          producten_nog_niet_bekend:
                            soort === "reparatie_deur"
                              ? edit.producten_nog_niet_bekend
                              : false,
                          fiets_ook_opgehaald:
                            soort === "reparatie_terugbrengen"
                              ? edit.fiets_ook_opgehaald
                              : false,
                          // Ophalen: productregels wissen.
                          regels:
                            soort === "reparatie_ophalen" ? [] : edit.regels,
                        });
                      }}
                    >
                      <option value="reparatie_deur">Reparatie aan huis</option>
                      <option value="reparatie_ophalen">Ophalen</option>
                      <option value="reparatie_terugbrengen">Terugbrengen</option>
                    </select>
                  </label>
                  {edit.soort !== "reparatie_ophalen" && (
                    <label className="block">
                      Betaling *
                      <select
                        className="mt-1 w-full rounded border px-2 py-2"
                        value={edit.betaalwijze ?? ""}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            betaalwijze: e.target.value as ReparatieBetaalwijze,
                          })
                        }
                      >
                        <option value="" disabled>
                          Kies contant of factuur…
                        </option>
                        <option value="factuur">Factuur</option>
                        <option value="contant">Contant</option>
                      </select>
                    </label>
                  )}
                  {edit.soort === "reparatie_ophalen" && (
                    <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-koopje-black/60">
                      Ophalen-orders krijgen geen factuur.
                    </p>
                  )}
                  <label className="block">
                    Naam
                    <input
                      className="mt-1 w-full rounded border px-2 py-2"
                      value={edit.naam}
                      onChange={(e) => setEdit({ ...edit, naam: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    E-mail
                    <input
                      className="mt-1 w-full rounded border px-2 py-2"
                      value={edit.email}
                      onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    Telefoon
                    <input
                      className="mt-1 w-full rounded border px-2 py-2"
                      value={edit.telefoonnummer}
                      onChange={(e) =>
                        setEdit({ ...edit, telefoonnummer: e.target.value })
                      }
                    />
                  </label>

                  <AdresAutocomplete
                    velden={{
                      straatnaam: edit.straatnaam,
                      huisnummer: edit.huisnummer,
                      postcode: edit.postcode,
                      woonplaats: edit.woonplaats,
                    }}
                    onChange={(v) =>
                      setEdit({
                        ...edit,
                        straatnaam: v.straatnaam,
                        huisnummer: v.huisnummer,
                        postcode: v.postcode,
                        woonplaats: v.woonplaats,
                      })
                    }
                  />

                  <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-koopje-black/70">
                    {voorrijLoading
                      ? "Voorrijkosten berekenen…"
                      : voorrijWeergave
                        ? edit.soort === "reparatie_terugbrengen" &&
                          edit.fiets_ook_opgehaald
                          ? `Afstand ≈ ${voorrijWeergave.km} km · Voorrijkosten ophalen + terugbrengen €${voorrijWeergave.bedrag.toFixed(2)} (2 × €${voorrijWeergave.basis.toFixed(2)})`
                          : `Afstand ≈ ${voorrijWeergave.km} km · Voorrijkosten €${voorrijWeergave.bedrag.toFixed(2)}`
                        : "Vul een adres in voor automatische voorrijkosten."}
                    {(needsProducts || voorrijWeergave) && (
                      <span className="ml-2 font-medium">
                        · Totaal ≈ €
                        {(subtotaal + (voorrijWeergave?.bedrag ?? 0)).toFixed(2)}
                      </span>
                    )}
                  </div>

                  {edit.soort === "reparatie_terugbrengen" && (
                    <label className="flex items-start gap-2 rounded-xl border border-koopje-orange/30 bg-koopje-orange-light/30 px-3 py-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={edit.fiets_ook_opgehaald}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            fiets_ook_opgehaald: e.target.checked,
                          })
                        }
                      />
                      <span>
                        <span className="font-medium text-koopje-black">
                          Fiets is ook opgehaald
                        </span>
                        <span className="mt-0.5 block text-koopje-black/60">
                          Voorrijkosten ×2 op de factuur (ophalen + terugbrengen).
                        </span>
                      </span>
                    </label>
                  )}

                  <label className="block">
                    Bezorgtijd voorkeur
                    <input
                      className="mt-1 w-full rounded border px-2 py-2"
                      value={edit.bezorgtijd_voorkeur}
                      onChange={(e) =>
                        setEdit({ ...edit, bezorgtijd_voorkeur: e.target.value })
                      }
                    />
                  </label>
                  <label className="block">
                    Datum voorkeur
                    <input
                      className="mt-1 w-full rounded border px-2 py-2"
                      value={edit.datum_voorkeur}
                      onChange={(e) =>
                        setEdit({ ...edit, datum_voorkeur: e.target.value })
                      }
                    />
                  </label>
                  <label className="block">
                    Opmerking
                    <textarea
                      className="mt-1 w-full rounded border px-2 py-2"
                      rows={2}
                      value={edit.opmerking}
                      onChange={(e) =>
                        setEdit({ ...edit, opmerking: e.target.value })
                      }
                    />
                  </label>

                  {reparatieSoortHeeftProducten(edit.soort) && (
                    <section className="space-y-3 rounded-xl border border-koopje-black/10 p-3">
                      {edit.soort === "reparatie_deur" && (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={edit.producten_nog_niet_bekend}
                            onChange={(e) =>
                              setEdit({
                                ...edit,
                                producten_nog_niet_bekend: e.target.checked,
                              })
                            }
                          />
                          Producten nog niet bekend
                        </label>
                      )}

                      {(edit.soort === "reparatie_terugbrengen" ||
                        !edit.producten_nog_niet_bekend) && (
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

                          {edit.regels.map((r) => (
                            <div
                              key={r.key}
                              className="rounded-lg border border-stone-200 p-3 text-sm"
                            >
                              {r.mode === "standaard" ? (
                                <p>
                                  <strong>{r.naam}</strong>
                                  <span className="text-koopje-black/50">
                                    {" "}
                                    · {r.onderdeel_naam || "onderdelen"} (€
                                    {r.onderdeel_prijs_incl}) · {r.arbeid_uren} u (€
                                    {arbeidPrijsIncl(
                                      parseFloat(r.arbeid_uren) || 0
                                    ).toFixed(2)}
                                    )
                                  </span>
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <ProductAutocomplete
                                    label="Onderdeel (Shopify)"
                                    value={r.onderdeel_naam}
                                    searchSource="shopify"
                                    productKind="extra"
                                    onChange={(title, prijs, meta) =>
                                      setEdit({
                                        ...edit,
                                        regels: edit.regels.map((x) =>
                                          x.key === r.key
                                            ? {
                                                ...x,
                                                onderdeel_naam: title,
                                                naam: title || x.naam,
                                                onderdeel_prijs_incl:
                                                  prijs ?? x.onderdeel_prijs_incl,
                                                shopify_product_id:
                                                  meta?.shopify_product_id ?? null,
                                                shopify_variant_id:
                                                  meta?.shopify_variant_id ?? null,
                                              }
                                            : x
                                        ),
                                      })
                                    }
                                  />
                                  <label className="block text-xs">
                                    Prijs onderdeel incl. 21%
                                    <input
                                      className="mt-0.5 w-full rounded border px-2 py-1.5"
                                      value={r.onderdeel_prijs_incl}
                                      onChange={(e) =>
                                        setEdit({
                                          ...edit,
                                          regels: edit.regels.map((x) =>
                                            x.key === r.key
                                              ? {
                                                  ...x,
                                                  onderdeel_prijs_incl: e.target.value,
                                                }
                                              : x
                                          ),
                                        })
                                      }
                                    />
                                  </label>
                                  <ArbeidUrenInput
                                    compact
                                    uren={r.arbeid_uren}
                                    onUrenChange={(u) =>
                                      setEdit({
                                        ...edit,
                                        regels: edit.regels.map((x) =>
                                          x.key === r.key
                                            ? { ...x, arbeid_uren: u }
                                            : x
                                        ),
                                      })
                                    }
                                  />
                                </div>
                              )}
                              <button
                                type="button"
                                className="mt-2 text-xs text-red-600"
                                onClick={() =>
                                  setEdit({
                                    ...edit,
                                    regels: edit.regels.filter((x) => x.key !== r.key),
                                  })
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
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-sm text-koopje-black/60"
                    onClick={() => {
                      setEdit(null);
                      setConfirmOpen(false);
                    }}
                  >
                    Annuleren
                  </button>
                  {!confirmOpen ? (
                    <button
                      type="button"
                      className="rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white"
                      onClick={() => setConfirmOpen(true)}
                    >
                      Opslaan
                    </button>
                  ) : (
                    <>
                      <span className="self-center text-sm text-koopje-black/70">
                        Weet u het zeker?
                      </span>
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-2 text-sm"
                        onClick={() => setConfirmOpen(false)}
                      >
                        Nee
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        className="rounded-lg bg-koopje-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        onClick={() => void doSave()}
                      >
                        {saving ? "Bezig…" : "Ja, opslaan"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
