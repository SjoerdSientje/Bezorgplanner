"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdresAutocomplete from "@/components/AdresAutocomplete";
import OrderMedewerkerPicker from "@/components/OrderMedewerkerPicker";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import type { OrderMedewerker } from "@/lib/order-medewerker";
import {
  normalizeStandaardOnderdelen,
  reparatieProductenKolomHead,
  standaardReparatieTotaalIncl,
  type ReparatieBetaalwijze,
  type ReparatieStandaardItem,
} from "@/lib/reparaties";
import {
  OPHAAL_MEEGENOMEN_ITEMS,
  parseOphalenMeegenomenJson,
  type OphaalMeegenomenItemId,
} from "@/lib/ophalen-meegenomen";

type OphaalListItem = {
  id: string;
  order_nummer: string | null;
  naam: string | null;
  producten: string | null;
  model: string | null;
  opgehaald_at: string | null;
};

type OphaalDetail = OphaalListItem & {
  email: string | null;
  telefoon_nummer: string | null;
  volledig_adres: string | null;
  achtergrondverhaal: string | null;
  opmerkingen_klant: string | null;
  voorrij_bedrag: number | null;
  voorrij_km: number | null;
  ophalen_meegenomen_json?: unknown;
  straatnaam?: string;
  huisnummer?: string;
  postcode?: string;
  woonplaats?: string;
};

type DraftRegel = {
  key: string;
  mode: "standaard" | "custom";
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

type Mode = "list" | "keuze" | "terugbrengen" | "winkelafhaal";

export default function OphaalOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OphaalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [selected, setSelected] = useState<OphaalDetail | null>(null);
  const [standaard, setStandaard] = useState<ReparatieStandaardItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Shared form state
  const [regels, setRegels] = useState<DraftRegel[]>([]);
  const [productenKolomTekst, setProductenKolomTekst] = useState("");
  const [achtergrondverhaal, setAchtergrondverhaal] = useState("");

  // Terugbrengen-only
  const [betaalwijze, setBetaalwijze] = useState<ReparatieBetaalwijze | "">("");
  const [aangemaaktDoor, setAangemaaktDoor] = useState<OrderMedewerker | "">("");
  const [opmerking, setOpmerking] = useState("");
  const [adres, setAdres] = useState({
    straatnaam: "",
    huisnummer: "",
    postcode: "",
    woonplaats: "",
  });
  const [voorrijOphalen, setVoorrijOphalen] = useState("");
  const [voorrijTerug, setVoorrijTerug] = useState("");
  const [meegenomenIds, setMeegenomenIds] = useState<OphaalMeegenomenItemId[]>(
    []
  );
  const [meegenomenTerug, setMeegenomenTerug] = useState<
    Record<string, boolean>
  >({});

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reparaties/ophaal-orders", {
        cache: "no-store",
      });
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
    void loadList();
    fetch(`/api/reparaties/prijslijst?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) =>
        setStandaard(Array.isArray(d.items) ? d.items : Array.isArray(d) ? d : [])
      )
      .catch(() => setStandaard([]));
  }, [loadList]);

  async function openOrder(id: string) {
    setError(null);
    setSuccessMsg(null);
    const res = await fetch(`/api/reparaties/ophaal-orders/${id}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Order laden mislukt");
      return;
    }
    const o = data.order as OphaalDetail;
    setSelected(o);
    setAchtergrondverhaal(String(o.achtergrondverhaal ?? ""));
    setOpmerking(String(o.opmerkingen_klant ?? ""));
    setAdres({
      straatnaam: o.straatnaam ?? "",
      huisnummer: o.huisnummer ?? "",
      postcode: o.postcode ?? "",
      woonplaats: o.woonplaats ?? "",
    });
    const basis =
      o.voorrij_bedrag != null && Number.isFinite(Number(o.voorrij_bedrag))
        ? Number(o.voorrij_bedrag).toFixed(2)
        : "0";
    setVoorrijOphalen(basis);
    setVoorrijTerug(basis);
    setRegels([]);
    setProductenKolomTekst("");
    setBetaalwijze("");
    setAangemaaktDoor("");
    const mee = parseOphalenMeegenomenJson(o.ophalen_meegenomen_json);
    setMeegenomenIds(mee);
    setMeegenomenTerug({});
    setMode("keuze");
  }

  function meegenomenTerugOk() {
    return meegenomenIds.every((id) => Boolean(meegenomenTerug[id]));
  }

  function addStandaard(id: string) {
    const s = standaard.find((i) => i.id === id);
    if (!s) return;
    const onderdelen = normalizeStandaardOnderdelen(s);
    const prijs = standaardReparatieTotaalIncl(s);
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
        arbeid_uren: String(s.arbeid_uren ?? 0),
      },
    ]);
  }

  function addCustom() {
    setRegels((prev) => [
      ...prev,
      {
        key: mkKey(),
        mode: "custom",
        naam: "",
        onderdeel_naam: "",
        onderdeel_prijs_incl: "0",
        arbeid_uren: "0",
      },
    ]);
  }

  const model = String(selected?.model ?? "").trim();
  const productenHead = useMemo(
    () =>
      reparatieProductenKolomHead(
        mode === "winkelafhaal" ? "reparatie_ophalen" : "reparatie_terugbrengen",
        model || "…"
      ),
    [mode, model]
  );

  function buildRegelsPayload() {
    return regels.map((r) =>
      r.mode === "standaard"
        ? {
            kind: "standaard" as const,
            standaard_id: r.standaard_id,
            naam: r.naam,
            onderdeel_prijs_incl:
              parseFloat(r.onderdeel_prijs_incl.replace(",", ".")) || 0,
            arbeid_uren: parseFloat(r.arbeid_uren.replace(",", ".")) || 0,
          }
        : {
            kind: "custom" as const,
            naam: r.naam || r.onderdeel_naam || "Reparatie",
            onderdeel_naam: r.onderdeel_naam || r.naam || "Reparatie",
            onderdeel_prijs_incl:
              parseFloat(r.onderdeel_prijs_incl.replace(",", ".")) || 0,
            shopify_product_id: r.shopify_product_id ?? null,
            shopify_variant_id: r.shopify_variant_id ?? null,
            arbeid_uren: parseFloat(r.arbeid_uren.replace(",", ".")) || 0,
          }
    );
  }

  async function submitTerugbrengen() {
    if (!selected) return;
    if (!betaalwijze) {
      setError("Kies contant of factuur.");
      return;
    }
    if (!aangemaaktDoor) {
      setError("Kies wie deze order aanmaakt.");
      return;
    }
    if (regels.length === 0) {
      setError("Voeg minstens één reparatieregel toe.");
      return;
    }
    if (!meegenomenTerugOk()) {
      setError(
        "Vink af dat alle bij ophalen meegenomen items weer worden meegegeven."
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reparaties/ophaal-orders/${selected.id}/terugbrengen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            betaalwijze,
            aangemaakt_door: aangemaaktDoor,
            model,
            naam: selected.naam,
            email: selected.email,
            telefoonnummer: selected.telefoon_nummer,
            straatnaam: adres.straatnaam,
            huisnummer: adres.huisnummer,
            postcode: adres.postcode,
            woonplaats: adres.woonplaats,
            opmerking,
            achtergrondverhaal,
            producten_kolom_tekst: productenKolomTekst.trim() || undefined,
            voorrij_ophalen_bedrag: voorrijOphalen,
            voorrij_terugbrengen_bedrag: voorrijTerug,
            regels: buildRegelsPayload(),
            ophalen_meegenomen_teruggegeven: meegenomenIds.filter(
              (id) => meegenomenTerug[id]
            ),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      router.push("/bezorgplanner/ritjes-vandaag");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function submitWinkelafhaal() {
    if (!selected) return;
    if (regels.length === 0) {
      setError("Voeg minstens één reparatieregel toe.");
      return;
    }
    if (!meegenomenTerugOk()) {
      setError(
        "Vink af dat alle bij ophalen meegenomen items weer worden meegegeven."
      );
      return;
    }
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(
        `/api/reparaties/ophaal-orders/${selected.id}/winkelafhaal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            achtergrondverhaal,
            producten_kolom_tekst: productenKolomTekst.trim() || undefined,
            regels: buildRegelsPayload(),
            ophalen_meegenomen_teruggegeven: meegenomenIds.filter(
              (id) => meegenomenTerug[id]
            ),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Afronden mislukt");
      const nr = data.estimateNumber
        ? ` Offertenummer: ${data.estimateNumber}.`
        : "";
      setSuccessMsg(
        `Fiets-afhaal afgerond; conceptofferte aangemaakt (niet verzonden).${nr}`
      );
      setMode("list");
      setSelected(null);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afronden mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-white">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-4">
          {(mode !== "list" || selected) && (
            <button
              type="button"
              onClick={() => {
                setMode("list");
                setSelected(null);
                setError(null);
              }}
              className="text-koopje-black/60 hover:text-koopje-black"
              aria-label="Terug"
            >
              ←
            </button>
          )}
          <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
            Ophaal orders
          </h1>
        </div>

        <p className="mb-6 text-sm text-koopje-black/60">
          Opgehaalde fietsen die wachten op terugbrengen of winkelafhaal.
        </p>

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {successMsg && (
          <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {successMsg}
          </p>
        )}

        {mode === "list" && (
          <>
            {loading ? (
              <p className="text-sm text-koopje-black/50">Laden…</p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-koopje-black/50">
                Geen openstaande ophaalorders.
              </p>
            ) : (
              <ul className="divide-y divide-koopje-black/10 rounded-xl border border-koopje-black/10">
                {orders.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => void openOrder(o.id)}
                      className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-stone-50"
                    >
                      <span className="font-medium text-koopje-black">
                        {o.naam || "Naamloos"}
                        {o.order_nummer ? (
                          <span className="ml-2 text-sm font-normal text-koopje-black/50">
                            {o.order_nummer}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm text-koopje-black/70">
                        {o.producten || "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {mode === "keuze" && selected && (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-koopje-black">
                {selected.naam}{" "}
                <span className="text-sm font-normal text-koopje-black/50">
                  {selected.order_nummer}
                </span>
              </p>
              <p className="mt-1 text-sm text-koopje-black/70">
                {selected.producten}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("terugbrengen")}
                className="rounded-xl border border-koopje-orange bg-koopje-orange px-4 py-4 text-left font-medium text-white hover:bg-koopje-orange/90"
              >
                Fiets terugbrengen
              </button>
              <button
                type="button"
                onClick={() => setMode("winkelafhaal")}
                className="rounded-xl border border-koopje-black/15 bg-white px-4 py-4 text-left font-medium text-koopje-black hover:border-koopje-orange"
              >
                Fiets wordt opgehaald
              </button>
            </div>
          </div>
        )}

        {(mode === "terugbrengen" || mode === "winkelafhaal") && selected && (
          <div className="space-y-5">
            <p className="text-sm text-koopje-black/60">
              {mode === "terugbrengen"
                ? "Nieuwe terugbreng-order (gaat naar ritjes vandaag)."
                : "Conceptofferte aanmaken; order gaat naar bezorgde orders."}
            </p>

            {mode === "terugbrengen" && (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Betaling</legend>
                  <label className="mr-4 inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={betaalwijze === "factuur"}
                      onChange={() => setBetaalwijze("factuur")}
                    />
                    Factuur
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={betaalwijze === "contant"}
                      onChange={() => setBetaalwijze("contant")}
                    />
                    Contant
                  </label>
                </fieldset>

                <div>
                  <p className="mb-1 text-sm font-medium text-koopje-black">
                    Adres (alleen voor de rit; wijzigt Moneybird-klant niet)
                  </p>
                  <AdresAutocomplete velden={adres} onChange={setAdres} />
                </div>

                <OrderMedewerkerPicker
                  value={aangemaaktDoor}
                  onChange={setAangemaaktDoor}
                />

                <label className="block text-sm">
                  Opmerking
                  <textarea
                    className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2"
                    rows={2}
                    value={opmerking}
                    onChange={(e) => setOpmerking(e.target.value)}
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    Voorrijkosten ophalen (€)
                    <input
                      className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2"
                      value={voorrijOphalen}
                      onChange={(e) => setVoorrijOphalen(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Voorrijkosten terugbrengen (€)
                    <input
                      className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2"
                      value={voorrijTerug}
                      onChange={(e) => setVoorrijTerug(e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}

            <label className="block text-sm">
              Achtergrondverhaal
              <textarea
                className="mt-1 w-full rounded-xl border border-koopje-black/20 px-3 py-2"
                rows={4}
                value={achtergrondverhaal}
                onChange={(e) => setAchtergrondverhaal(e.target.value)}
              />
            </label>

            <section className="space-y-3">
              <h2 className="text-sm font-medium">
                {mode === "winkelafhaal" ? "Offerteconcept" : "Factuurconcept"}
              </h2>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-lg border border-koopje-black/20 px-2 py-1.5 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) addStandaard(e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="">+ Standaardreparatie</option>
                  {standaard.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.naam}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addCustom}
                  className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-sm"
                >
                  + Custom
                </button>
              </div>

              <ul className="space-y-2">
                {regels.map((r) => (
                  <li
                    key={r.key}
                    className="rounded-xl border border-koopje-black/10 p-3"
                  >
                    {r.mode === "custom" ? (
                      <div className="space-y-2">
                        <ProductAutocomplete
                          label="Product"
                          value={r.onderdeel_naam}
                          onChange={(naam, prijs, meta) =>
                            setRegels((prev) =>
                              prev.map((x) =>
                                x.key === r.key
                                  ? {
                                      ...x,
                                      onderdeel_naam: naam,
                                      naam: naam || x.naam,
                                      shopify_product_id:
                                        meta?.shopify_product_id ?? null,
                                      shopify_variant_id:
                                        meta?.shopify_variant_id ?? null,
                                      onderdeel_prijs_incl:
                                        prijs != null && prijs !== ""
                                          ? prijs
                                          : x.onderdeel_prijs_incl,
                                    }
                                  : x
                              )
                            )
                          }
                          placeholder="Product zoeken…"
                        />
                        <input
                          className="w-28 rounded border px-2 py-1 text-sm"
                          value={r.onderdeel_prijs_incl}
                          onChange={(e) =>
                            setRegels((prev) =>
                              prev.map((x) =>
                                x.key === r.key
                                  ? {
                                      ...x,
                                      onderdeel_prijs_incl: e.target.value,
                                    }
                                  : x
                              )
                            )
                          }
                          placeholder="€"
                        />
                      </div>
                    ) : (
                      <p className="text-sm font-medium">{r.naam}</p>
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
                  </li>
                ))}
              </ul>

              <label className="block text-sm text-koopje-black/70">
                Optioneel: tekst in productenkolom
                <div className="mt-1 flex overflow-hidden rounded-xl border border-koopje-black/20">
                  <span className="shrink-0 border-r border-koopje-black/10 bg-stone-50 px-3 py-2 text-sm">
                    {productenHead}
                  </span>
                  <input
                    className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
                    value={productenKolomTekst}
                    onChange={(e) => setProductenKolomTekst(e.target.value)}
                    placeholder="leeg = standaardregels"
                  />
                </div>
              </label>
            </section>

            {meegenomenIds.length > 0 && (
              <section className="space-y-3 rounded-xl border border-koopje-black/10 p-4">
                <h2 className="text-sm font-medium text-koopje-black">
                  {mode === "terugbrengen"
                    ? "Mee teruggeven aan de bezorger/klant"
                    : "Mee teruggeven bij winkelafhaal"}
                </h2>
                <p className="text-xs text-koopje-black/55">
                  Bij ophalen meegegeven — vink af dat dit weer meegaat.
                </p>
                <div className="space-y-2">
                  {meegenomenIds.map((id) => {
                    const item = OPHAAL_MEEGENOMEN_ITEMS.find((i) => i.id === id);
                    const label = item?.label ?? id;
                    return (
                      <label
                        key={id}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 text-sm ${
                          meegenomenTerug[id]
                            ? "border-green-200 bg-green-50"
                            : "border-stone-200 bg-white hover:bg-stone-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-koopje-orange"
                          checked={Boolean(meegenomenTerug[id])}
                          onChange={(e) =>
                            setMeegenomenTerug((prev) => ({
                              ...prev,
                              [id]: e.target.checked,
                            }))
                          }
                        />
                        <span className="text-koopje-black">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void (mode === "terugbrengen"
                  ? submitTerugbrengen()
                  : submitWinkelafhaal())
              }
              className="w-full rounded-xl bg-koopje-orange py-3 font-medium text-white hover:bg-koopje-orange/90 disabled:opacity-60"
            >
              {saving
                ? "Bezig…"
                : mode === "terugbrengen"
                  ? "Terugbreng-order aanmaken"
                  : "Winkelafhaal afronden + offerte"}
            </button>
          </div>
        )}

        {mode === "list" && (
          <p className="mt-8 text-sm">
            <Link href="/reparaties" className="text-koopje-orange hover:underline">
              ← Reparaties
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
