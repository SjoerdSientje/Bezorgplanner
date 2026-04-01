"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { stripMpDummyPricesFromLineItemsJsonString } from "@/lib/line-items-json-sanitize";
import {
  DEFAULT_PRODUCT_RULES_V1,
  applyProductDefaultItemsRules,
  isProductDefaultItemsRulesV1,
  type ProductDefaultItemsRulesV1,
} from "@/lib/product-default-items-rules";

/** Oude MP-data: fiets op €999 dummy — tonen als €0 tot DB-migratie is gedraaid. */
function effectiveLineItemsJson(json: string | null | undefined): string | null | undefined {
  if (!json) return json;
  const { json: out } = stripMpDummyPricesFromLineItemsJsonString(json);
  return out ?? json;
}

interface LineItem {
  name: string;
  price: number;
  isFiets: boolean;
  properties: { name: string; value: string }[];
  defaultItems?: string[];
}

interface EditRow {
  _id: string;
  name: string;
  price: string; // string zodat gebruiker vrij kan typen
  isFiets: boolean;
  properties: { name: string; value: string }[];
  defaultItems?: string[];
}

interface Props {
  value: string;
  lineItemsJson?: string | null;
  bestellingTotaalPrijs?: number | null;
  /** Simpele tekst-save (legacy, wordt niet meer gebruikt in ritjes-vandaag) */
  onSave?: (value: string) => void;
  /** Multi-field save: producten + line_items_json + bestelling_totaal_prijs (= som regelprijzen) */
  onSaveMulti?: (fields: Record<string, unknown>) => Promise<void>;
}

type LeveringOption = "Volledig rijklaar" | "In doos";
type MountedExtra = "achterzitje" | "voorrekje";
type AccessoryStatus = "geen" | "gemonteerd" | "apart";

let idCounter = 0;
function genId() { return String(++idCounter); }

function parseToEditRows(lineItemsJson: string | null | undefined, fallbackText: string): EditRow[] {
  if (lineItemsJson) {
    try {
      const raw = effectiveLineItemsJson(lineItemsJson) ?? lineItemsJson;
      const items = JSON.parse(raw) as LineItem[];
      return normalizeRowsForEdit(items
        .map((item) => ({
          _id: genId(),
          name: item.name ?? "",
          price: item.price != null ? String(item.price) : "0",
          isFiets: item.isFiets ?? false,
          properties: item.properties ?? [],
          defaultItems: item.defaultItems ?? [],
        }))
        .map(normalizeRowMountedTitle));
    } catch { /* fall through */ }
  }
  if (fallbackText) {
    return fallbackText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ _id: genId(), name, price: "0", isFiets: false, properties: [], defaultItems: [] }));
  }
  return [];
}

function buildLineItemsJsonFromRows(rows: EditRow[]): string {
  const items: LineItem[] = rows.map(({ _id: _, price, ...rest }) => ({
    ...rest,
    price: parseFloat(price) || 0,
  }));
  return JSON.stringify(items);
}

function sumRowPrices(rows: EditRow[]): number {
  return rows.reduce((sum, r) => {
    const n = parseFloat(r.price);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function sumLineItemPrices(items: LineItem[]): number {
  return items.reduce((sum, i) => {
    const n = Number(i.price);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function normalizeLeveringValue(v: string): LeveringOption | null {
  const n = String(v ?? "").trim().toLowerCase();
  if (n === "volledig rijklaar" || n === "rijklaar") return "Volledig rijklaar";
  if (n === "in doos") return "In doos";
  return null;
}

function getLeveringValue(properties: { name: string; value: string }[]): LeveringOption | null {
  const p = properties.find((prop) => String(prop.name ?? "").trim().toLowerCase() === "levering");
  return normalizeLeveringValue(p?.value ?? "");
}

function withLeveringProperty(
  properties: { name: string; value: string }[],
  levering: LeveringOption
): { name: string; value: string }[] {
  let found = false;
  const next = properties.map((p) => {
    if (String(p.name ?? "").trim().toLowerCase() !== "levering") return p;
    found = true;
    return { ...p, value: levering };
  });
  if (!found) next.push({ name: "Levering", value: levering });
  return next;
}

function parseMountedExtrasFromText(text: string): Set<MountedExtra> {
  const out = new Set<MountedExtra>();
  const t = String(text ?? "").toLowerCase();
  if (t.includes("achterzitje gemonteerd")) out.add("achterzitje");
  if (t.includes("voorrekje gemonteerd")) out.add("voorrekje");
  return out;
}

function parseApartExtrasFromText(text: string): Set<MountedExtra> {
  const out = new Set<MountedExtra>();
  const t = String(text ?? "").toLowerCase();
  if (t.includes("achterzitje apart")) out.add("achterzitje");
  if (t.includes("voorrekje apart")) out.add("voorrekje");
  if (t.includes("los achterzitje")) out.add("achterzitje");
  if (t.includes("los voorrekje")) out.add("voorrekje");
  return out;
}

function parseMountedExtrasFromProperties(
  properties: { name: string; value: string }[]
): Set<MountedExtra> {
  const out = new Set<MountedExtra>();
  for (const p of properties ?? []) {
    if (String(p.name ?? "").trim().toLowerCase() !== "montage") continue;
    const found = parseMountedExtrasFromText(String(p.value ?? ""));
    found.forEach((x) => out.add(x));
  }
  return out;
}

function parseApartExtrasFromProperties(
  properties: { name: string; value: string }[]
): Set<MountedExtra> {
  const out = new Set<MountedExtra>();
  for (const p of properties ?? []) {
    const name = String(p.name ?? "").toLowerCase();
    const value = String(p.value ?? "").toLowerCase();
    const text = `${name} ${value}`;
    const hasApart = text.includes("apart") || text.includes("los");
    if (!hasApart) continue;
    if (text.includes("achterzitje")) out.add("achterzitje");
    if (text.includes("voorrekje")) out.add("voorrekje");
  }
  return out;
}

function parseAccessoryStatesFromProperties(
  properties: { name: string; value: string }[]
): { mounted: Set<MountedExtra>; apart: Set<MountedExtra> } {
  const mounted = new Set<MountedExtra>();
  const apart = new Set<MountedExtra>();
  for (const p of properties ?? []) {
    const name = String(p.name ?? "").toLowerCase();
    const value = String(p.value ?? "").toLowerCase();
    const text = `${name} ${value}`;
    const isAccessory = text.includes("achterzitje") || text.includes("voorrekje");
    if (!isAccessory) continue;
    const isMounted = text.includes("gemonteerd");
    const isApart = text.includes("apart") || text.includes("los");
    if (text.includes("achterzitje")) {
      if (isMounted) mounted.add("achterzitje");
      if (isApart) apart.add("achterzitje");
    }
    if (text.includes("voorrekje")) {
      if (isMounted) mounted.add("voorrekje");
      if (isApart) apart.add("voorrekje");
    }
  }
  return { mounted, apart };
}

function accessoryFromExtraName(name: string): MountedExtra | null {
  const n = String(name ?? "").trim().toLowerCase();
  if (n === "achterzitje" || n === "los achterzitje") return "achterzitje";
  if (n === "voorrekje" || n === "los voorrekje") return "voorrekje";
  return null;
}

function stripManagedTitleSuffix(name: string): string {
  return String(name ?? "")
    .replace(/\s*-\s*volledig rijklaar\s*(?:-\s*.*)?$/i, "")
    .replace(/\s*-\s*in doos\s*(?:-\s*.*)?$/i, "")
    .replace(/\bvolledig\s+rijklaar\b/gi, "")
    .replace(/\bin\s+doos\b/gi, "")
    .replace(/\s*\+\s*achterzitje\s+gemonteerd/gi, "")
    .replace(/\s*\+\s*voorrekje\s+gemonteerd/gi, "")
    .replace(/\s*\+\s*achterzitje\s+apart/gi, "")
    .replace(/\s*\+\s*voorrekje\s+apart/gi, "")
    .replace(/\s*-\s*$/g, "")
    .replace(/\+\s*\+/g, "+")
    .trim();
}

function buildBikeTitle(
  rawName: string,
  levering: LeveringOption,
  mounted: Set<MountedExtra>,
  apart: Set<MountedExtra>
): string {
  const base = stripManagedTitleSuffix(rawName);
  const bits: string[] = [];
  if (levering === "Volledig rijklaar") {
    if (mounted.has("achterzitje")) bits.push("achterzitje gemonteerd");
    if (mounted.has("voorrekje")) bits.push("voorrekje gemonteerd");
    if (apart.has("achterzitje")) bits.push("achterzitje apart");
    if (apart.has("voorrekje")) bits.push("voorrekje apart");
    return bits.length ? `${base} - volledig rijklaar - ${bits.join(" + ")}` : `${base} - volledig rijklaar`;
  }
  if (apart.has("achterzitje")) bits.push("achterzitje apart");
  if (apart.has("voorrekje")) bits.push("voorrekje apart");
  return bits.length ? `${base} - in doos - ${bits.join(" + ")}` : `${base} - in doos`;
}

function removeMountedFromMontageProperties(
  properties: { name: string; value: string }[]
): { cleaned: { name: string; value: string }[]; mounted: Set<MountedExtra> } {
  const mounted = new Set<MountedExtra>();
  const cleaned: { name: string; value: string }[] = [];
  for (const p of properties ?? []) {
    if (String(p.name ?? "").trim().toLowerCase() !== "montage") {
      cleaned.push(p);
      continue;
    }
    const raw = String(p.value ?? "");
    const found = parseMountedExtrasFromText(raw);
    found.forEach((x) => mounted.add(x));
    const nextValue = raw
      .replace(/(^|\+)\s*achterzitje\s+gemonteerd\s*(?=\+|$)/gi, "")
      .replace(/(^|\+)\s*voorrekje\s+gemonteerd\s*(?=\+|$)/gi, "")
      .replace(/\+\s*\+/g, "+")
      .replace(/^\s*\+\s*|\s*\+\s*$/g, "")
      .trim();
    if (nextValue) cleaned.push({ ...p, value: nextValue });
  }
  return { cleaned, mounted };
}

function stripAccessoryProperties(
  properties: { name: string; value: string }[]
): { name: string; value: string }[] {
  return (properties ?? []).filter((p) => {
    const name = String(p.name ?? "").toLowerCase();
    const value = String(p.value ?? "").toLowerCase();
    const text = `${name} ${value}`;
    if (name === "montage") return true;
    if (text.includes("achterzitje")) return false;
    if (text.includes("voorrekje")) return false;
    return true;
  });
}

function mergeMountedSets(...sets: Set<MountedExtra>[]): Set<MountedExtra> {
  const out = new Set<MountedExtra>();
  for (const s of sets) {
    s.forEach((v) => out.add(v));
  }
  return out;
}

function statusFromSets(
  acc: MountedExtra,
  mounted: Set<MountedExtra>,
  apart: Set<MountedExtra>
): AccessoryStatus {
  if (mounted.has(acc)) return "gemonteerd";
  if (apart.has(acc)) return "apart";
  return "geen";
}

function updateAccessoryProperties(
  properties: { name: string; value: string }[],
  levering: LeveringOption,
  mounted: Set<MountedExtra>,
  apart: Set<MountedExtra>
): { name: string; value: string }[] {
  const base = stripAccessoryProperties(properties).filter(
    (p) => String(p.name ?? "").trim().toLowerCase() !== "levering"
  );
  const next: { name: string; value: string }[] = [
    { name: "Levering", value: levering.toLowerCase() },
    ...base,
  ];
  const achterzitje = statusFromSets("achterzitje", mounted, apart);
  const voorrekje = statusFromSets("voorrekje", mounted, apart);
  if (achterzitje !== "geen") next.push({ name: "Achterzitje", value: achterzitje });
  if (voorrekje !== "geen") next.push({ name: "Voorrekje", value: voorrekje });
  const montageBits: string[] = [];
  if (achterzitje === "gemonteerd") montageBits.push("achterzitje gemonteerd");
  if (voorrekje === "gemonteerd") montageBits.push("voorrekje gemonteerd");
  if (montageBits.length > 0) next.push({ name: "Montage", value: montageBits.join(" + ") });
  return next;
}

function normalizeRowMountedTitle(row: EditRow): EditRow {
  if (!row.isFiets) return row;
  const levering = getLeveringValue(row.properties ?? []);
  if (!levering) return row;
  const fromTitle = parseMountedExtrasFromText(row.name);
  const apartFromTitle = parseApartExtrasFromText(row.name);
  const fromProps = parseMountedExtrasFromProperties(row.properties ?? []);
  const apartFromProps = parseApartExtrasFromProperties(row.properties ?? []);
  const mounted = mergeMountedSets(fromTitle, fromProps);
  const apart = mergeMountedSets(apartFromTitle, apartFromProps);
  const cleanedProps = stripAccessoryProperties(row.properties ?? []);
  if (levering === "In doos") {
    const mergedApart = mergeMountedSets(apart, mounted);
    return {
      ...row,
      name: buildBikeTitle(row.name, levering, new Set<MountedExtra>(), mergedApart),
      properties: cleanedProps,
    };
  }
  return {
    ...row,
    name: buildBikeTitle(row.name, levering, mounted, new Set<MountedExtra>()),
    properties: cleanedProps,
  };
}

function normalizeRowsForEdit(rows: EditRow[]): EditRow[] {
  const next = rows
    .map((r) => normalizeRowMountedTitle({ ...r }))
    .filter((r) => !(r.isFiets === false && String(r.name ?? "").trim().toLowerCase() === "volledig rijklaar"));
  const existingExtras = new Set(
    next
      .filter((r) => !r.isFiets)
      .map((r) => accessoryFromExtraName(r.name))
      .filter(Boolean) as MountedExtra[]
  );

  for (const row of next) {
    if (!row.isFiets) continue;
    const levering = getLeveringValue(row.properties ?? []);
    if (levering !== "In doos") continue;

    const mountedInTitle = parseMountedExtrasFromText(row.name);
    const apartInTitle = parseApartExtrasFromText(row.name);
    const removed = removeMountedFromMontageProperties(row.properties ?? []);
    const mounted = mergeMountedSets(mountedInTitle, removed.mounted);
    if (mounted.size === 0) continue;

    const apart = mergeMountedSets(apartInTitle, mounted);
    row.name = buildBikeTitle(row.name, "In doos", new Set<MountedExtra>(), apart);
    row.properties = updateAccessoryProperties(removed.cleaned, "In doos", new Set<MountedExtra>(), apart);

    mounted.forEach((extra) => {
      if (!existingExtras.has(extra)) {
        next.push({
          _id: genId(),
          name: extra === "achterzitje" ? "los achterzitje" : "los voorrekje",
          price: "0",
          isFiets: false,
          properties: [],
          defaultItems: [],
        });
        existingExtras.add(extra);
      }
    });
  }

  return next;
}

export default function ProductenCell({
  value,
  lineItemsJson,
  bestellingTotaalPrijs,
  onSave,
  onSaveMulti,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("0");
  const [saving, setSaving] = useState(false);
  const [productRules, setProductRules] = useState<ProductDefaultItemsRulesV1>(DEFAULT_PRODUCT_RULES_V1);
  const ref = useRef<HTMLDivElement>(null);

  // Lokale display-state — wordt direct na opslaan bijgewerkt zodat de cel
  // meteen de nieuwe producten en prijs toont, onafhankelijk van parent-state.
  const [localValue, setLocalValue] = useState(value);
  const [localLineItemsJson, setLocalLineItemsJson] = useState(lineItemsJson);

  // Sync van props bij externe update (bijv. initieel laden of verversen)
  useEffect(() => { setLocalValue(value); }, [value]);
  useEffect(() => { setLocalLineItemsJson(lineItemsJson); }, [lineItemsJson]);

  // Sluit paneel als buiten geklikt
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (editing) return; // niet sluiten terwijl aan het bewerken
        setPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/product-rules?t=${Date.now()}`, { cache: "no-store" })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (isProductDefaultItemsRulesV1(data?.rules)) {
          setProductRules(data.rules);
        }
      })
      .catch(() => {
        // Fallback blijft DEFAULT_PRODUCT_RULES_V1.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lees producten uit JSON/tekst bij openen
  function openPanel() {
    setRows(normalizeRowsForEdit(parseToEditRows(localLineItemsJson, localValue)));
    setEditing(false);
    setPanelOpen(true);
  }

  function startEditing() {
    setRows(normalizeRowsForEdit(parseToEditRows(localLineItemsJson, localValue)));
    setNewName("");
    setNewPrice("0");
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setRows(normalizeRowsForEdit(parseToEditRows(localLineItemsJson, localValue)));
  }

  function updateRow(id: string, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((r) => r._id === id ? { ...r, ...patch } : r));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r._id !== id));
  }

  function addProduct() {
    const name = newName.trim();
    if (!name) return;
    setRows((prev) => [
      ...prev,
      { _id: genId(), name, price: newPrice || "0", isFiets: false, properties: [], defaultItems: [] },
    ]);
    setNewName("");
    setNewPrice("0");
  }

  function updateLevering(id: string, levering: LeveringOption) {
    setRows((prev) => {
      const next = prev.map((r) => ({ ...r }));
      const idx = next.findIndex((r) => r._id === id);
      if (idx < 0) return prev;
      const target = next[idx];
      if (!target.isFiets) return prev;

      let properties = withLeveringProperty(target.properties ?? [], levering);
      const mountedInTitle = parseMountedExtrasFromText(target.name);
      const apartInTitle = parseApartExtrasFromText(target.name);
      const mountedInProps = parseMountedExtrasFromProperties(properties);
      const apartInProps = parseApartExtrasFromProperties(properties);
      const genericAccessoryProps = parseAccessoryStatesFromProperties(properties);
      const allDetected = mergeMountedSets(
        mountedInTitle,
        apartInTitle,
        mountedInProps,
        apartInProps,
        genericAccessoryProps.mounted,
        genericAccessoryProps.apart
      );

      const existingExtraRows = next
        .filter((r) => !r.isFiets)
        .map((r) => ({ name: String(r.name ?? "").trim().toLowerCase(), id: r._id }));
      for (const e of existingExtraRows) {
        const acc = accessoryFromExtraName(e.name);
        if (acc) allDetected.add(acc);
      }

      const removed = removeMountedFromMontageProperties(properties);
      properties = stripAccessoryProperties(removed.cleaned);
      let mounted = new Set<MountedExtra>();
      let apart = new Set<MountedExtra>();

      if (levering === "In doos") {
        // In doos kan nooit gemonteerd zijn.
        apart = allDetected;
      } else {
        // Bij switch naar rijklaar: vraag voor aanwezige accessoires los of gemonteerd.
        if (allDetected.has("achterzitje")) {
          const m = window.confirm("Achterzitje aanwezig. Gemonteerd? (OK = gemonteerd, Annuleren = apart)");
          if (m) mounted.add("achterzitje");
          else apart.add("achterzitje");
        }
        if (allDetected.has("voorrekje")) {
          const m = window.confirm("Voorrekje aanwezig. Gemonteerd? (OK = gemonteerd, Annuleren = apart)");
          if (m) mounted.add("voorrekje");
          else apart.add("voorrekje");
        }
      }

      const name = buildBikeTitle(target.name, levering, mounted, apart);
      properties = updateAccessoryProperties(properties, levering, mounted, apart);

      // "Volledig rijklaar" mag nooit als los extra product bestaan.
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (i === idx || next[i].isFiets) continue;
        if (String(next[i].name ?? "").trim().toLowerCase() === "volledig rijklaar") {
          next.splice(i, 1);
        }
      }

      // Accessoire-extra regels exact syncen met 'apart' status.
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (i === idx || next[i].isFiets) continue;
        const acc = accessoryFromExtraName(next[i].name);
        if (!acc) continue;
        if (!apart.has(acc)) next.splice(i, 1);
      }
      apart.forEach((acc) => {
        const exists = next.some(
          (r, i) => i !== idx && !r.isFiets && accessoryFromExtraName(r.name) === acc
        );
        if (!exists) {
          next.push({
            _id: genId(),
            name: acc === "achterzitje" ? "los achterzitje" : "los voorrekje",
            price: "0",
            isFiets: false,
            properties: [],
            defaultItems: [],
          });
        }
      });

      const defaultItems = applyProductDefaultItemsRules(name ?? "", properties, productRules);
      next[idx] = { ...target, name, properties, defaultItems };
      return next;
    });
  }

  const rowSum = sumRowPrices(rows);

  const saveEdits = useCallback(async () => {
    setSaving(true);
    try {
      const newLineItemsJson = buildLineItemsJsonFromRows(rows);
      const newProductenText = rows.map((r) => r.name).filter(Boolean).join("\n");
      const hasUsableLineItemsJson = (() => {
        if (!localLineItemsJson) return false;
        try {
          const raw = effectiveLineItemsJson(localLineItemsJson) ?? localLineItemsJson;
          const parsed = JSON.parse(raw) as unknown;
          return Array.isArray(parsed) && parsed.length > 0;
        } catch {
          return false;
        }
      })();
      const existingTotal =
        typeof bestellingTotaalPrijs === "number" && Number.isFinite(bestellingTotaalPrijs)
          ? bestellingTotaalPrijs
          : 0;
      const totalForSave =
        !hasUsableLineItemsJson && rowSum === 0 && existingTotal > 0
          ? existingTotal
          : rowSum;

      // Meteen de lokale display bijwerken — cel toont nieuwe producten direct.
      setLocalValue(newProductenText);
      setLocalLineItemsJson(newLineItemsJson);

      if (onSaveMulti) {
        await onSaveMulti({
          producten: newProductenText || null,
          line_items_json: newLineItemsJson,
          bestelling_totaal_prijs: totalForSave,
        });
      } else if (onSave) {
        onSave(newProductenText);
      }
      setEditing(false);
      setPanelOpen(false);
    } finally {
      setSaving(false);
    }
  }, [rows, rowSum, onSaveMulti, onSave, localLineItemsJson, bestellingTotaalPrijs]);

  // Platte weergavetekst — gebruikt lokale state zodat wijzigingen direct zichtbaar zijn
  let displayItems: LineItem[] = [];
  if (localLineItemsJson) {
    try {
      const raw = effectiveLineItemsJson(localLineItemsJson) ?? localLineItemsJson;
      displayItems = JSON.parse(raw) as LineItem[];
    } catch { /* ignore */ }
  }
  const hasStructured = displayItems.length > 0;
  const displayText = localValue || "—";
  /** Onderaan de popup: altijd de som van de regelprijzen (zelfde als bij opslaan in bestelling_totaal_prijs). */
  const displaySum = sumLineItemPrices(displayItems);

  return (
    <div ref={ref} className="relative">
      {/* Cel-inhoud */}
      <button
        type="button"
        onClick={openPanel}
        className="w-full px-2 py-1.5 text-left text-sm text-stone-700 hover:bg-koopje-orange-light/40"
      >
        <span className="line-clamp-2 leading-snug">{displayText}</span>
        <span className="ml-1 inline-block align-middle text-[10px] text-koopje-orange opacity-70">▾</span>
      </button>

      {/* Paneel */}
      {panelOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-96 rounded-xl border border-stone-200 bg-white shadow-2xl"
          style={{ minWidth: "22rem" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              {editing ? "Producten bewerken" : "Productoverzicht"}
            </p>
            <div className="flex gap-1">
              {!editing && (onSaveMulti || onSave) && (
                <button
                  type="button"
                  onClick={startEditing}
                  title="Bewerken"
                  className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-koopje-orange"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => { setPanelOpen(false); setEditing(false); }}
                className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-3">
            {editing ? (
              /* ── Edit mode ── */
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <div
                    key={row._id}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                      row.isFiets ? "border-koopje-orange/30 bg-orange-50" : "border-stone-200 bg-stone-50"
                    }`}
                  >
                    {row.isFiets && <span className="shrink-0 text-[10px]">🚲</span>}
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(row._id, { name: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-700 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                      placeholder="Productnaam"
                    />
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span className="text-xs text-stone-400">€</span>
                      <input
                        type="number"
                        value={row.price}
                        onChange={(e) => updateRow(row._id, { price: e.target.value })}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-700 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                        step="0.01"
                        min="0"
                      />
                    </div>
                    {row.isFiets && (
                      <select
                        value={getLeveringValue(row.properties ?? []) ?? ""}
                        onChange={(e) => {
                          const v = normalizeLeveringValue(e.target.value);
                          if (!v) return;
                          updateLevering(row._id, v);
                        }}
                        className="shrink-0 rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[11px] text-stone-700 focus:border-koopje-orange focus:outline-none"
                        title="Levering"
                      >
                        <option value="">Levering…</option>
                        <option value="Volledig rijklaar">Volledig rijklaar</option>
                        <option value="In doos">In doos</option>
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRow(row._id)}
                      className="shrink-0 rounded p-0.5 text-stone-300 hover:bg-red-50 hover:text-red-500"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}

                {/* Nieuw product toevoegen */}
                <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-2 py-1.5">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProduct(); } }}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-500 placeholder:text-stone-300 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                    placeholder="Nieuw product…"
                  />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <span className="text-xs text-stone-400">€</span>
                    <input
                      type="number"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-stone-500 focus:border-koopje-orange/40 focus:bg-white focus:outline-none"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addProduct}
                    disabled={!newName.trim()}
                    className="shrink-0 rounded p-0.5 text-stone-300 hover:bg-green-50 hover:text-green-600 disabled:opacity-30"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>

                {/* Zelfde bedrag als bestelling_totaal_prijs na opslaan */}
                <div className="flex items-center justify-between rounded-lg bg-stone-100 px-2 py-1.5 text-xs">
                  <span className="font-medium text-stone-500">Bestelling totaal</span>
                  <span className="font-semibold text-stone-700">€ {rowSum.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              /* ── View mode ── */
              <div className="space-y-2">
                {hasStructured ? (
                  displayItems.map((item, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-3 py-2 ${
                        item.isFiets ? "border-koopje-orange/30 bg-orange-50" : "border-stone-200 bg-stone-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-sm font-semibold leading-snug ${item.isFiets ? "text-koopje-orange" : "text-stone-700"}`}>
                          {item.isFiets && <span className="mr-1 text-[10px]">🚲</span>}
                          {item.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs text-stone-400">
                          €{Number.isFinite(item.price) ? item.price.toFixed(2) : "0.00"}
                        </span>
                      </div>
                      {item.properties.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 border-t border-stone-200 pt-1.5">
                          {item.properties.map((p, j) => (
                            <li key={j} className="flex gap-1.5 text-xs text-stone-600">
                              <span className="font-medium text-stone-500">{p.name}:</span>
                              <span>{p.value}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.defaultItems && item.defaultItems.length > 0 && (
                        <div className="mt-1.5 border-t border-dashed border-stone-200 pt-1.5">
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">Standaard inbegrepen</p>
                          <ul className="space-y-0.5">
                            {item.defaultItems.map((d, j) => (
                              <li key={j} className="flex items-center gap-1.5 text-xs text-stone-500">
                                <span className="text-[10px]">📦</span>{d}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    {value || "—"}
                  </div>
                )}
                {hasStructured && (
                  <div className="flex items-center justify-between rounded-lg bg-stone-100 px-3 py-2 text-xs">
                    <span className="font-medium text-stone-500">Bestelling totaal</span>
                    <span className="font-semibold text-stone-700">€ {displaySum.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer knoppen (alleen edit mode) */}
          {editing && (
            <div className="flex gap-2 border-t border-stone-100 px-3 py-2">
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="flex-1 rounded-lg border border-stone-200 py-1.5 text-xs font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-50"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={saving}
                className="flex-1 rounded-lg bg-koopje-orange py-1.5 text-xs font-medium text-white hover:bg-koopje-orange-dark disabled:opacity-50"
              >
                {saving ? "Opslaan…" : "Opslaan"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
