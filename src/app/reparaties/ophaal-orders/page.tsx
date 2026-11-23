"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdresAutocomplete from "@/components/AdresAutocomplete";
import OrderMedewerkerPicker from "@/components/OrderMedewerkerPicker";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import type { OrderMedewerker } from "@/lib/order-medewerker";
import {
  arbeidPrijsIncl,
  arbeidUrenFromPrijsIncl,
  buildReparatieProductenKolom,
  normalizeStandaardOnderdelen,
  reparatieProductenKolomHead,
  standaardReparatieTotaalIncl,
  type ReparatieBetaalwijze,
  type ReparatieOnderdeel,
  type ReparatieStandaardItem,
} from "@/lib/reparaties";
import {
  OPHAAL_MEEGENOMEN_ITEMS,
  parseOphalenMeegenomenJson,
  type OphaalMeegenomenItemId,
} from "@/lib/ophalen-meegenomen";
import {
  formatKlantOrderDateTime,
  formatKlantOrderPrijs,
} from "@/lib/klant-orderhistorie-shared";

type OphaalListItem = {
  id: string;
  order_nummer: string | null;
  naam: string | null;
  producten: string | null;
  model: string | null;
  opgehaald_at: string | null;
  opgehaald_door?: string | null;
  aangemaakt_door?: string | null;
  created_at?: string | null;
  email?: string | null;
  telefoon_nummer?: string | null;
  volledig_adres?: string | null;
  achtergrondverhaal?: string | null;
  opmerkingen_klant?: string | null;
  voorrij_bedrag?: number | null;
  voorrij_km?: number | null;
  line_items_json?: string | null;
  reparatie_regels_json?: unknown;
  bestelling_totaal_prijs?: number | null;
  bezorger_naam?: string | null;
};

type WinkelafhaalRecent = {
  id: string;
  order_nummer: string | null;
  naam: string | null;
  producten: string | null;
  model: string | null;
  afgerond_at: string | null;
  moneybird_estimate_number: string | null;
  bestelling_totaal_prijs: number | null;
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

function parseLineItemsForGegevens(
  lineItemsJson: string | null | undefined
): Array<{ naam: string; prijs: number | null }> {
  if (!lineItemsJson) return [];
  try {
    const items = JSON.parse(lineItemsJson) as Array<{
      name?: string | null;
      price?: number | string | null;
    }>;
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => {
        const naam = String(item?.name ?? "").trim();
        if (!naam) return null;
        const raw = item?.price;
        const prijs =
          typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? parseFloat(raw.replace(",", "."))
              : NaN;
        return {
          naam,
          prijs: Number.isFinite(prijs) ? prijs : null,
        };
      })
      .filter((x): x is { naam: string; prijs: number | null } => x != null);
  } catch {
    return [];
  }
}

type RegelMode = "standaard" | "custom" | "vrij";

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

type Mode = "list" | "keuze" | "terugbrengen" | "winkelafhaal";

export default function OphaalOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OphaalListItem[]>([]);
  const [recenteWinkelafhaal, setRecenteWinkelafhaal] = useState<
    WinkelafhaalRecent[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [selected, setSelected] = useState<OphaalDetail | null>(null);
  const [standaard, setStandaard] = useState<ReparatieStandaardItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [gegevensOrder, setGegevensOrder] = useState<OphaalListItem | null>(
    null
  );

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
  const [arbeidBedragStr, setArbeidBedragStr] = useState("");
  const [arbeidManual, setArbeidManual] = useState(false);
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
      setRecenteWinkelafhaal(data.recenteWinkelafhaal ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  async function factureerWinkelafhaal(id: string) {
    setBusyId(id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(
        `/api/reparaties/ophaal-orders/${id}/factureer`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Factureren mislukt");
      setSuccessMsg("Factuur aangemaakt en verzonden.");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Factureren mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function heropenVoorTerugbrengen(id: string) {
    if (
      !window.confirm(
        "Conceptofferte wissen en order terugzetten naar ophaal-wachtkamer? Daarna kun je Fiets terugbrengen kiezen."
      )
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/reparaties/ophaal-orders/${id}/heropen`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Heropenen mislukt");
      setSuccessMsg(
        "Order staat weer bij ophaalorders — kies Fiets terugbrengen."
      );
      await loadList();
      await openOrder(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Heropenen mislukt");
    } finally {
      setBusyId(null);
    }
  }

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
    setArbeidBedragStr("");
    setArbeidManual(false);
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

  function setArbeidBedrag(raw: string) {
    setArbeidManual(true);
    setArbeidBedragStr(raw);
    const bedrag = parseFloat(raw.replace(",", ".")) || 0;
    const uren = arbeidUrenFromPrijsIncl(bedrag);
    const urenStr = uren > 0 ? String(Math.round(uren * 10000) / 10000) : "0";
    setRegels((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((r, i) =>
        i === 0 ? { ...r, arbeid_uren: urenStr } : { ...r, arbeid_uren: "0" }
      );
    });
  }

  function addStandaardRegel(id: string) {
    const s = standaard.find((i) => i.id === id);
    if (!s) return;
    const onderdelen = normalizeStandaardOnderdelen(s);
    setArbeidManual(false);
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
        arbeid_uren: "0",
      },
    ]);
  }

  function addVrijeTekstRegel() {
    setRegels((prev) => [
      ...prev,
      {
        key: mkKey(),
        mode: "vrij",
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
        arbeid_uren: "0",
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

  const model = String(selected?.model ?? "").trim();
  const factuurSoort =
    mode === "winkelafhaal" ? "reparatie_ophalen" : "reparatie_terugbrengen";
  const productenHead = useMemo(
    () => reparatieProductenKolomHead(factuurSoort, model || "…"),
    [factuurSoort, model]
  );

  const autoArbeidBedrag = useMemo(() => {
    const uren = regels.reduce(
      (sum, r) => sum + (parseFloat(r.arbeid_uren.replace(",", ".")) || 0),
      0
    );
    return arbeidPrijsIncl(uren);
  }, [regels]);

  useEffect(() => {
    if (arbeidManual) return;
    setArbeidBedragStr(
      autoArbeidBedrag > 0 ? autoArbeidBedrag.toFixed(2) : ""
    );
  }, [autoArbeidBedrag, arbeidManual]);

  const arbeidBedragParsed = parseFloat(arbeidBedragStr.replace(",", ".")) || 0;

  const subtotaalRegels = useMemo(() => {
    const producten = regels.reduce((sum, r) => {
      return (
        sum +
        r.onderdelen.reduce(
          (s, o) => s + (parseFloat(o.prijs_incl.replace(",", ".")) || 0),
          0
        )
      );
    }, 0);
    return producten + arbeidBedragParsed;
  }, [regels, arbeidBedragParsed]);

  const voorrijOphalenNum = parseFloat(voorrijOphalen.replace(",", ".")) || 0;
  const voorrijTerugNum = parseFloat(voorrijTerug.replace(",", ".")) || 0;
  const voorrijTotaal =
    mode === "terugbrengen"
      ? voorrijOphalenNum + voorrijTerugNum
      : voorrijOphalenNum;
  const totaal = subtotaalRegels + voorrijTotaal;

  const defaultProductenKolom = useMemo(() => {
    return buildReparatieProductenKolom({
      soort: factuurSoort,
      modelnaam: model,
      vrijeTekst: productenKolomTekst || null,
      regels: productenKolomTekst
        ? []
        : regels.map((r) => ({
            naam: r.naam,
            onderdeel_naam: r.onderdelen
              .map((o) => o.naam)
              .filter(Boolean)
              .join(" + "),
          })),
      voorrijBedrag: voorrijTotaal > 0 ? voorrijTotaal : null,
    });
  }, [
    factuurSoort,
    model,
    productenKolomTekst,
    regels,
    voorrijTotaal,
  ]);

  function buildRegelsPayload() {
    const arbeidUren = arbeidUrenFromPrijsIncl(arbeidBedragParsed);
    return regels.map((r, i) => {
      const uren = i === 0 ? arbeidUren : 0;
      if (r.mode === "vrij") {
        const naam = r.naam.trim();
        const prijs =
          parseFloat((r.onderdelen[0]?.prijs_incl ?? "0").replace(",", ".")) ||
          0;
        return {
          kind: "custom" as const,
          naam,
          onderdeel_naam: naam,
          onderdeel_prijs_incl: prijs,
          shopify_product_id: null,
          shopify_variant_id: null,
          onderdelen: [{ naam, prijs_incl: prijs }],
          arbeid_uren: uren,
        };
      }
      const onderdelen = r.onderdelen
        .filter((o) => o.naam.trim())
        .map((o) => ({
          naam: o.naam.trim(),
          prijs_incl: parseFloat(o.prijs_incl.replace(",", ".")) || 0,
          shopify_product_id: o.shopify_product_id ?? null,
          shopify_variant_id: o.shopify_variant_id ?? null,
        }));
      const onderdeelPrijs = onderdelen.reduce((s, o) => s + o.prijs_incl, 0);
      if (r.mode === "standaard") {
        return {
          kind: "standaard" as const,
          standaard_id: r.standaard_id,
          naam: r.naam,
          onderdeel_prijs_incl: onderdeelPrijs,
          onderdelen,
          arbeid_uren: uren,
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
        arbeid_uren: uren,
      };
    });
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
      setError("Voeg minstens één factuurregel toe.");
      return;
    }
    if (regels.some((r) => r.mode === "vrij" && !r.naam.trim())) {
      setError("Vul een omschrijving in bij elke vrije tekstregel.");
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
      setError("Voeg minstens één factuurregel toe.");
      return;
    }
    if (regels.some((r) => r.mode === "vrij" && !r.naam.trim())) {
      setError("Vul een omschrijving in bij elke vrije tekstregel.");
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
            voorrij_ophalen_bedrag: voorrijOphalen,
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
              <ul className="space-y-3">
                {orders.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-xl border border-koopje-black/10 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <button
                        type="button"
                        onClick={() => void openOrder(o.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="font-medium text-koopje-black">
                          {o.naam || "Naamloos"}
                          {o.order_nummer ? (
                            <span className="ml-2 text-sm font-normal text-koopje-black/50">
                              {o.order_nummer}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-sm text-koopje-black/70">
                          {o.producten || "—"}
                        </span>
                        {o.opgehaald_at && (
                          <span className="mt-1 block text-xs text-koopje-black/45">
                            Opgehaald{" "}
                            {formatKlantOrderDateTime(o.opgehaald_at) || "—"}
                            {o.opgehaald_door
                              ? ` · door ${o.opgehaald_door}`
                              : ""}
                          </span>
                        )}
                      </button>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setGegevensOrder(o)}
                          className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-sm text-koopje-black hover:border-koopje-orange"
                        >
                          Gegevens
                        </button>
                        <button
                          type="button"
                          onClick={() => void openOrder(o.id)}
                          className="rounded-lg bg-koopje-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-koopje-orange/90"
                        >
                          Vervolg
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <section className="mt-10 space-y-3">
              <div>
                <h2 className="text-base font-semibold text-koopje-black">
                  Recente winkelafhaal (7 dagen)
                </h2>
                <p className="mt-1 text-sm text-koopje-black/55">
                  Conceptofferte open — factureer &amp; verstuur, of zet terug
                  naar ophalen als de fiets toch moet worden teruggebracht.
                </p>
              </div>
              {loading ? null : recenteWinkelafhaal.length === 0 ? (
                <p className="text-sm text-koopje-black/45">
                  Geen openstaande winkelafhaal-offertes.
                </p>
              ) : (
                <ul className="divide-y divide-koopje-black/10 rounded-xl border border-koopje-black/10">
                  {recenteWinkelafhaal.map((o) => (
                    <li
                      key={o.id}
                      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-koopje-black">
                          {o.naam || "Naamloos"}
                          {o.order_nummer ? (
                            <span className="ml-2 text-sm font-normal text-koopje-black/50">
                              {o.order_nummer}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-sm text-koopje-black/70">
                          {o.producten || "—"}
                        </p>
                        <p className="mt-1 text-xs text-koopje-black/50">
                          Offerte:{" "}
                          {o.moneybird_estimate_number?.trim() || "—"}
                          {o.bestelling_totaal_prijs != null
                            ? ` · €${Number(o.bestelling_totaal_prijs).toFixed(2)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => void factureerWinkelafhaal(o.id)}
                          className="rounded-lg bg-koopje-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-koopje-orange/90 disabled:opacity-60"
                        >
                          {busyId === o.id
                            ? "Bezig…"
                            : "Factureer & verstuur"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => void heropenVoorTerugbrengen(o.id)}
                          className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-sm text-koopje-black hover:border-koopje-orange disabled:opacity-60"
                        >
                          Toch terugbrengen
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
              <h2 className="text-sm font-medium text-koopje-black">
                {mode === "winkelafhaal" ? "Offerte (concept)" : "Factuur (concept)"}
              </h2>

              <div className="flex flex-wrap items-center gap-2">
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
                  <option value="">
                    {standaard.length === 0
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
                <button
                  type="button"
                  onClick={addVrijeTekstRegel}
                  className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-sm"
                >
                  + Vrije tekstregel
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-koopje-black/15 bg-white">
                <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-koopje-black/10 bg-stone-50 px-4 py-2 text-xs font-medium text-koopje-black/45">
                  <span>Omschrijving</span>
                  <span className="w-24 text-right">Bedrag</span>
                </div>
                <ul className="divide-y divide-stone-100">
                  {regels.length === 0 && (
                    <li className="px-4 py-6 text-center text-sm text-koopje-black/40">
                      Nog geen factuurregels — voeg een product toe
                    </li>
                  )}

                  {regels.flatMap((r) => {
                    if (r.mode === "vrij") {
                      const o = r.onderdelen[0];
                      return [
                        <li
                          key={r.key}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 text-sm"
                        >
                          <input
                            type="text"
                            className="min-w-0 border-0 bg-transparent p-0 text-sm text-koopje-black outline-none placeholder:text-koopje-black/30"
                            value={r.naam}
                            placeholder="Omschrijving…"
                            onChange={(e) => {
                              const naam = e.target.value;
                              setRegels((prev) =>
                                prev.map((x) =>
                                  x.key !== r.key
                                    ? x
                                    : {
                                        ...x,
                                        naam,
                                        onderdelen: x.onderdelen.map((oo, i) =>
                                          i === 0 ? { ...oo, naam } : oo
                                        ),
                                      }
                                )
                              );
                            }}
                            aria-label="Vrije tekstregel omschrijving"
                          />
                          <label className="flex w-24 items-center justify-end gap-1 tabular-nums text-koopje-black">
                            <span className="text-koopje-black/40">€</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="w-16 border-0 bg-transparent p-0 text-right text-sm outline-none focus:ring-0"
                              value={o?.prijs_incl ?? ""}
                              onChange={(e) => {
                                if (!o) return;
                                patchOnderdeel(r.key, o.key, {
                                  prijs_incl: e.target.value,
                                });
                              }}
                              aria-label="Bedrag vrije tekstregel"
                            />
                          </label>
                          <button
                            type="button"
                            className="text-koopje-black/30 hover:text-red-600"
                            title="Regel verwijderen"
                            onClick={() => removeRegel(r.key)}
                          >
                            ×
                          </button>
                        </li>,
                      ];
                    }

                    if (
                      r.mode === "custom" &&
                      !r.onderdelen[0]?.shopify_product_id
                    ) {
                      return [
                        <li key={r.key} className="space-y-2 px-4 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
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
                                    ...(prijs != null
                                      ? { prijs_incl: prijs }
                                      : {}),
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
                            </div>
                            <button
                              type="button"
                              className="mt-6 text-xs text-red-600 hover:underline"
                              onClick={() => removeRegel(r.key)}
                            >
                              ×
                            </button>
                          </div>
                        </li>,
                      ];
                    }

                    return r.onderdelen.map((o) => (
                      <li
                        key={`${r.key}-${o.key}`}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 text-sm"
                      >
                        <span className="min-w-0 text-koopje-black">
                          {o.naam || "—"}
                        </span>
                        <label className="flex w-24 items-center justify-end gap-1 tabular-nums text-koopje-black">
                          <span className="text-koopje-black/40">€</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-16 border-0 bg-transparent p-0 text-right text-sm outline-none focus:ring-0"
                            value={o.prijs_incl}
                            onChange={(e) =>
                              patchOnderdeel(r.key, o.key, {
                                prijs_incl: e.target.value,
                              })
                            }
                            aria-label={`Prijs ${o.naam}`}
                          />
                        </label>
                        <button
                          type="button"
                          className="text-koopje-black/30 hover:text-red-600"
                          title="Regel verwijderen"
                          onClick={() => {
                            if (r.onderdelen.length <= 1) {
                              removeRegel(r.key);
                              return;
                            }
                            setRegels((prev) =>
                              prev.map((x) =>
                                x.key !== r.key
                                  ? x
                                  : {
                                      ...x,
                                      onderdelen: x.onderdelen.filter(
                                        (oo) => oo.key !== o.key
                                      ),
                                    }
                              )
                            );
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ));
                  })}

                  {regels.length > 0 && (
                    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="text-koopje-black">Arbeidskosten</span>
                      <label className="flex w-24 items-center justify-end gap-1 tabular-nums text-koopje-black">
                        <span className="text-koopje-black/40">€</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-16 border-0 bg-transparent p-0 text-right text-sm outline-none focus:ring-0"
                          value={arbeidBedragStr}
                          onChange={(e) => setArbeidBedrag(e.target.value)}
                          aria-label="Arbeidskosten"
                        />
                      </label>
                      <span className="w-4" />
                    </li>
                  )}

                  {mode === "terugbrengen" ? (
                    <>
                      <li className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 text-sm">
                        <span className="text-koopje-black">
                          Voorrijkosten ophalen
                        </span>
                        <label className="flex w-24 items-center justify-end gap-1 tabular-nums text-koopje-black">
                          <span className="text-koopje-black/40">€</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-16 border-0 bg-transparent p-0 text-right text-sm outline-none"
                            value={voorrijOphalen}
                            onChange={(e) => setVoorrijOphalen(e.target.value)}
                            aria-label="Voorrijkosten ophalen"
                          />
                        </label>
                        <span className="w-4" />
                      </li>
                      <li className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 text-sm">
                        <span className="text-koopje-black">
                          Voorrijkosten terugbrengen
                        </span>
                        <label className="flex w-24 items-center justify-end gap-1 tabular-nums text-koopje-black">
                          <span className="text-koopje-black/40">€</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-16 border-0 bg-transparent p-0 text-right text-sm outline-none"
                            value={voorrijTerug}
                            onChange={(e) => setVoorrijTerug(e.target.value)}
                            aria-label="Voorrijkosten terugbrengen"
                          />
                        </label>
                        <span className="w-4" />
                      </li>
                    </>
                  ) : (
                    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="text-koopje-black">Voorrijkosten</span>
                      <label className="flex w-24 items-center justify-end gap-1 tabular-nums text-koopje-black">
                        <span className="text-koopje-black/40">€</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-16 border-0 bg-transparent p-0 text-right text-sm outline-none"
                          value={voorrijOphalen}
                          onChange={(e) => setVoorrijOphalen(e.target.value)}
                          aria-label="Voorrijkosten"
                        />
                      </label>
                      <span className="w-4" />
                    </li>
                  )}
                </ul>
                <div className="flex items-center justify-between border-t border-koopje-black/15 px-4 py-3 text-sm font-semibold text-koopje-black">
                  <span>Totaal incl. btw</span>
                  <span className="tabular-nums">€{totaal.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-koopje-black/10 bg-stone-50/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Productenkolom (standaard)
                </p>
                <p className="rounded-lg border border-dashed border-koopje-black/15 bg-white px-3 py-2 text-sm text-koopje-black">
                  {defaultProductenKolom || productenHead}
                </p>
                <label className="block text-sm text-koopje-black/70">
                  Optioneel: andere tekst in productenkolom
                  <div className="mt-1 flex overflow-hidden rounded-xl border border-koopje-black/20 bg-white">
                    <span className="shrink-0 select-none border-r border-koopje-black/10 bg-stone-50 px-3 py-2.5 text-sm text-koopje-black/70">
                      {productenHead}
                    </span>
                    <input
                      className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none"
                      value={productenKolomTekst}
                      onChange={(e) =>
                        setProductenKolomTekst(
                          e.target.value
                            .replace(
                              /^(reparatie aan huis|terugbrengen|ophalen):\s*/i,
                              ""
                            )
                            .replace(
                              new RegExp(
                                `^${model
                                  .trim()
                                  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`,
                                "i"
                              ),
                              ""
                            )
                        )
                      }
                      placeholder="leeg = standaardregels"
                    />
                  </div>
                </label>
              </div>
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

      {gegevensOrder && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Ordergegevens"
          onClick={() => setGegevensOrder(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-koopje-black">
                  Gegevens
                </h2>
                <p className="text-sm text-koopje-black/55">
                  {gegevensOrder.order_nummer || gegevensOrder.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGegevensOrder(null)}
                className="rounded-lg px-2 py-1 text-sm text-koopje-black/50 hover:bg-stone-100 hover:text-koopje-black"
              >
                Sluiten
              </button>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Naam
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {gegevensOrder.naam || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Telefoon
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {gegevensOrder.telefoon_nummer || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Adres
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {gegevensOrder.volledig_adres || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  E-mail
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {gegevensOrder.email || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Fiets opgehaald op
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {formatKlantOrderDateTime(gegevensOrder.opgehaald_at) || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Order opgehaald door
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {gegevensOrder.opgehaald_door ||
                    gegevensOrder.bezorger_naam ||
                    "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Order aangemaakt door
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {gegevensOrder.aangemaakt_door || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Voorrijkosten
                </dt>
                <dd className="mt-1 text-sm text-koopje-black">
                  {gegevensOrder.voorrij_bedrag != null
                    ? formatKlantOrderPrijs(Number(gegevensOrder.voorrij_bedrag))
                    : "—"}
                  {gegevensOrder.voorrij_km != null
                    ? ` (${gegevensOrder.voorrij_km} km)`
                    : ""}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Producten / arbeid + kosten
                </dt>
                <dd className="mt-2 space-y-1.5 text-sm text-koopje-black">
                  {(() => {
                    const items = parseLineItemsForGegevens(
                      gegevensOrder.line_items_json
                    );
                    if (items.length > 0) {
                      return (
                        <ul className="space-y-1.5">
                          {items.map((p, idx) => (
                            <li
                              key={`${p.naam}-${idx}`}
                              className="flex justify-between gap-3"
                            >
                              <span>{p.naam}</span>
                              <span className="shrink-0 text-koopje-black/60">
                                {formatKlantOrderPrijs(p.prijs)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      );
                    }
                    return (
                      <p className="whitespace-pre-wrap">
                        {gegevensOrder.producten || "—"}
                      </p>
                    );
                  })()}
                  {gegevensOrder.bestelling_totaal_prijs != null && (
                    <p className="pt-1 font-medium">
                      Totaal{" "}
                      {formatKlantOrderPrijs(
                        Number(gegevensOrder.bestelling_totaal_prijs)
                      )}
                    </p>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Opmerking
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-koopje-black">
                  {gegevensOrder.opmerkingen_klant?.trim() || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-koopje-black/45">
                  Achtergrondverhaal
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-koopje-black">
                  {gegevensOrder.achtergrondverhaal?.trim() || "—"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </main>
  );
}
