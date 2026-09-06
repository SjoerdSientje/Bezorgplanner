"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyExceptionGroup,
  createEmptyMatch,
  createEmptyModelExtraGroup,
  createEmptyRuleItem,
  type ProductDefaultItemsRulesV2,
  type ProductRuleDeliveryBlock,
  type ProductRuleExceptionGroup,
  type ProductRuleItem,
  type ProductRuleItemKind,
  type ProductRuleMatch,
  type ProductRuleMatchMode,
  type ProductRuleModelExtraGroup,
} from "@/lib/product-default-items-rules";

type InventorySearchHit = {
  inventory_product_id?: string;
  title: string;
  stock_quantity?: number | null;
};

type Props = {
  rules: ProductDefaultItemsRulesV2;
  onChange: (next: ProductDefaultItemsRulesV2) => void;
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-koopje-black placeholder:text-stone-400 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange/40";

function InventoryProductPicker({
  selectedId,
  selectedTitle,
  onSelect,
}: {
  selectedId: string | null | undefined;
  selectedTitle: string | null | undefined;
  onSelect: (hit: { id: string; title: string } | null) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<InventorySearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/inventory/search?q=${encodeURIComponent(q.trim())}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!cancelled) setHits(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  if (selectedId) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
        <span className="font-medium text-koopje-black">
          {selectedTitle || "Voorraadregel gekoppeld"}
        </span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-sm text-red-700 underline decoration-red-700/40 hover:decoration-red-700"
        >
          Ontkoppelen
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative mt-1">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Zoek voorraadregel (min. 2 letters)…"
        className={fieldClass}
      />
      {open && q.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          {loading && (
            <li className="px-3 py-2 text-sm text-stone-500">Zoeken…</li>
          )}
          {!loading && hits.length === 0 && (
            <li className="px-3 py-2 text-sm text-stone-500">Geen resultaten</li>
          )}
          {hits.map((h) => {
            const id = h.inventory_product_id;
            if (!id) return null;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-orange-50"
                  onClick={() => {
                    onSelect({ id, title: h.title });
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="text-koopje-black">{h.title}</span>
                  {h.stock_quantity != null && (
                    <span className="shrink-0 text-xs text-stone-500">
                      voorraad {h.stock_quantity}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RuleItemEditor({
  item,
  onChange,
  onRemove,
}: {
  item: ProductRuleItem;
  onChange: (next: ProductRuleItem) => void;
  onRemove: () => void;
}) {
  const setKind = (kind: ProductRuleItemKind) => {
    if (kind === "text") {
      onChange({
        ...item,
        kind: "text",
        inventoryProductId: null,
        inventoryProductTitle: null,
      });
    } else {
      onChange({
        ...item,
        kind: "inventory",
        label: item.label || item.inventoryProductTitle || "",
      });
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setKind("inventory")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              item.kind === "inventory"
                ? "bg-koopje-orange text-white"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            Met voorraadregel
          </button>
          <button
            type="button"
            onClick={() => setKind("text")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              item.kind === "text"
                ? "bg-koopje-orange text-white"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            Alleen tekst (geen voorraad)
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-sm text-red-700 underline decoration-red-700/40 hover:decoration-red-700"
        >
          Verwijderen
        </button>
      </div>

      {item.kind === "inventory" ? (
        <div className="mt-3 space-y-2">
          <InventoryProductPicker
            selectedId={item.inventoryProductId}
            selectedTitle={item.inventoryProductTitle}
            onSelect={(hit) => {
              if (!hit) {
                onChange({
                  ...item,
                  inventoryProductId: null,
                  inventoryProductTitle: null,
                });
                return;
              }
              onChange({
                ...item,
                inventoryProductId: hit.id,
                inventoryProductTitle: hit.title,
                label: item.label.trim() || hit.title,
              });
            }}
          />
          <label className="block text-xs font-medium text-stone-600">
            Naam op paklijst (optioneel anders dan voorraadnaam)
          </label>
          <input
            value={item.label}
            onChange={(e) => onChange({ ...item, label: e.target.value })}
            placeholder={item.inventoryProductTitle || "Bijv. ART-2 kettingslot"}
            className={fieldClass}
          />
        </div>
      ) : (
        <div className="mt-3">
          <label className="block text-xs font-medium text-stone-600">
            Tekstregel — gebruik {"{model}"} voor de modelnaam
          </label>
          <input
            value={item.label}
            onChange={(e) => onChange({ ...item, label: e.target.value })}
            placeholder="Bijv. Opladerdoosje {model}"
            className={fieldClass}
          />
        </div>
      )}
    </div>
  );
}

function MatchEditor({
  match,
  onChange,
  onRemove,
}: {
  match: ProductRuleMatch;
  onChange: (next: ProductRuleMatch) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="sm:w-44">
        <label className="text-xs font-medium text-stone-600">Match</label>
        <select
          value={match.mode}
          onChange={(e) =>
            onChange({ ...match, mode: e.target.value as ProductRuleMatchMode })
          }
          className={fieldClass}
        >
          <option value="contains">Bevat deze woorden / merk</option>
          <option value="exact">Exact dit model</option>
        </select>
      </div>
      <div className="min-w-0 flex-1">
        <label className="text-xs font-medium text-stone-600">Waarde</label>
        <input
          value={match.value}
          onChange={(e) => onChange({ ...match, value: e.target.value })}
          placeholder={match.mode === "exact" ? "V20 PRO comfort" : "engwe"}
          className={fieldClass}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="pb-2 text-sm text-red-700 underline decoration-red-700/40 hover:decoration-red-700"
      >
        Weg
      </button>
    </div>
  );
}

function ItemListEditor({
  items,
  onChange,
}: {
  items: ProductRuleItem[];
  onChange: (next: ProductRuleItem[]) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <RuleItemEditor
          key={item.id}
          item={item}
          onChange={(next) => {
            const copy = [...items];
            copy[i] = next;
            onChange(copy);
          }}
          onRemove={() => onChange(items.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, createEmptyRuleItem("text")])}
        className="rounded-lg border border-dashed border-koopje-orange/50 bg-white px-3 py-2 text-sm font-medium text-koopje-black hover:bg-orange-50/80"
      >
        + Product toevoegen
      </button>
    </div>
  );
}

function ExceptionGroupEditor({
  group,
  standardItems,
  onChange,
  onRemove,
}: {
  group: ProductRuleExceptionGroup;
  standardItems: ProductRuleItem[];
  onChange: (next: ProductRuleExceptionGroup) => void;
  onRemove: () => void;
}) {
  const toggleExclude = (itemId: string) => {
    const set = new Set(group.excludeItemIds);
    if (set.has(itemId)) set.delete(itemId);
    else set.add(itemId);
    onChange({ ...group, excludeItemIds: Array.from(set) });
  };

  return (
    <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          value={group.name}
          onChange={(e) => onChange({ ...group, name: e.target.value })}
          className={`${fieldClass} mt-0 max-w-md font-medium`}
          placeholder="Naam uitzonderingsgroep"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-sm text-red-700 underline decoration-red-700/40 hover:decoration-red-700"
        >
          Groep verwijderen
        </button>
      </div>

      <p className="mt-3 text-sm text-stone-600">
        Voor welke fietsen geldt deze uitzondering?
      </p>
      <div className="mt-2 space-y-2">
        {group.matches.map((m, i) => (
          <MatchEditor
            key={m.id}
            match={m}
            onChange={(next) => {
              const matches = [...group.matches];
              matches[i] = next;
              onChange({ ...group, matches });
            }}
            onRemove={() =>
              onChange({
                ...group,
                matches: group.matches.filter((_, j) => j !== i),
              })
            }
          />
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...group,
              matches: [...group.matches, createEmptyMatch("contains")],
            })
          }
          className="text-sm font-medium text-koopje-black underline decoration-koopje-orange/50"
        >
          + Matchregel
        </button>
      </div>

      <p className="mt-4 text-sm text-stone-600">
        Welke standaard-items komen <strong>niet</strong> mee?
      </p>
      {standardItems.length === 0 ? (
        <p className="mt-1 text-sm text-stone-500">
          Voeg eerst standaard-items toe hierboven.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {standardItems.map((item) => {
            const label =
              item.label.trim() ||
              item.inventoryProductTitle ||
              "(naamloos item)";
            return (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-koopje-black">
                  <input
                    type="checkbox"
                    checked={group.excludeItemIds.includes(item.id)}
                    onChange={() => toggleExclude(item.id)}
                    className="rounded border-stone-300 text-koopje-orange focus:ring-koopje-orange"
                  />
                  <span>Geen {label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ModelExtraGroupEditor({
  group,
  onChange,
  onRemove,
}: {
  group: ProductRuleModelExtraGroup;
  onChange: (next: ProductRuleModelExtraGroup) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          value={group.name}
          onChange={(e) => onChange({ ...group, name: e.target.value })}
          className={`${fieldClass} mt-0 max-w-md font-medium`}
          placeholder="Naam groep"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-sm text-red-700 underline decoration-red-700/40 hover:decoration-red-700"
        >
          Groep verwijderen
        </button>
      </div>

      <p className="mt-3 text-sm text-stone-600">Voor welke modellen?</p>
      <div className="mt-2 space-y-2">
        {group.matches.map((m, i) => (
          <MatchEditor
            key={m.id}
            match={m}
            onChange={(next) => {
              const matches = [...group.matches];
              matches[i] = next;
              onChange({ ...group, matches });
            }}
            onRemove={() =>
              onChange({
                ...group,
                matches: group.matches.filter((_, j) => j !== i),
              })
            }
          />
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...group,
              matches: [...group.matches, createEmptyMatch("contains")],
            })
          }
          className="text-sm font-medium text-koopje-black underline decoration-koopje-orange/50"
        >
          + Matchregel
        </button>
      </div>

      <p className="mt-4 text-sm font-medium text-koopje-black">Extra producten</p>
      <div className="mt-2">
        <ItemListEditor
          items={group.items}
          onChange={(items) => onChange({ ...group, items })}
        />
      </div>
    </div>
  );
}

function DeliveryBlockEditor({
  title,
  description,
  block,
  onChange,
}: {
  title: string;
  description: string;
  block: ProductRuleDeliveryBlock;
  onChange: (next: ProductRuleDeliveryBlock) => void;
}) {
  const setStandard = (standardItems: ProductRuleItem[]) => {
    const validIds = new Set(standardItems.map((i) => i.id));
    onChange({
      ...block,
      standardItems,
      exceptionGroups: block.exceptionGroups.map((g) => ({
        ...g,
        excludeItemIds: g.excludeItemIds.filter((id) => validIds.has(id)),
      })),
    });
  };

  return (
    <section className="rounded-xl border border-koopje-orange/25 bg-orange-50/30 p-5 shadow-sm">
      <h2 className="text-base font-semibold text-koopje-black">{title}</h2>
      <p className="mt-2 text-sm text-stone-600">{description}</p>

      <h3 className="mt-6 text-sm font-semibold text-koopje-black">
        Standaard inbegrepen
      </h3>
      <p className="mt-1 text-sm text-stone-600">
        Voor bijna alle fietsen met deze leverwijze.
      </p>
      <div className="mt-3">
        <ItemListEditor items={block.standardItems} onChange={setStandard} />
      </div>

      <h3 className="mt-8 text-sm font-semibold text-koopje-black">
        Uitzonderingsgroepen
      </h3>
      <p className="mt-1 text-sm text-stone-600">
        Bijv. bepaalde merken krijgen géén kettingslot of tasje.
      </p>
      <div className="mt-3 space-y-4">
        {block.exceptionGroups.map((g, i) => (
          <ExceptionGroupEditor
            key={g.id}
            group={g}
            standardItems={block.standardItems}
            onChange={(next) => {
              const exceptionGroups = [...block.exceptionGroups];
              exceptionGroups[i] = next;
              onChange({ ...block, exceptionGroups });
            }}
            onRemove={() =>
              onChange({
                ...block,
                exceptionGroups: block.exceptionGroups.filter((_, j) => j !== i),
              })
            }
          />
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...block,
              exceptionGroups: [...block.exceptionGroups, createEmptyExceptionGroup()],
            })
          }
          className="rounded-lg border border-dashed border-amber-400/70 bg-white px-4 py-2 text-sm font-medium text-koopje-black hover:bg-amber-50/80"
        >
          + Uitzonderingsgroep
        </button>
      </div>

      <h3 className="mt-8 text-sm font-semibold text-koopje-black">
        Extra alleen voor bepaalde modellen
      </h3>
      <p className="mt-1 text-sm text-stone-600">
        Extra standaard-spullen bovenop de lijst hierboven.
      </p>
      <div className="mt-3 space-y-4">
        {block.modelExtras.map((g, i) => (
          <ModelExtraGroupEditor
            key={g.id}
            group={g}
            onChange={(next) => {
              const modelExtras = [...block.modelExtras];
              modelExtras[i] = next;
              onChange({ ...block, modelExtras });
            }}
            onRemove={() =>
              onChange({
                ...block,
                modelExtras: block.modelExtras.filter((_, j) => j !== i),
              })
            }
          />
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...block,
              modelExtras: [...block.modelExtras, createEmptyModelExtraGroup()],
            })
          }
          className="rounded-lg border border-dashed border-koopje-orange/50 bg-white px-4 py-2 text-sm font-medium text-koopje-black hover:bg-orange-50/80"
        >
          + Modelgroep
        </button>
      </div>
    </section>
  );
}

export default function ProductRulesForm({ rules, onChange }: Props) {
  const setAlways = useCallback(
    (always: ProductRuleItem[]) => onChange({ ...rules, always }),
    [onChange, rules]
  );

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-koopje-black">
          Standaard inbegrepen bij alle fietsen
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Altijd mee, ongeacht rijklaar of in doos. Kies per regel een voorraadkoppeling
          of alleen een tekstregel (zoals opladerdoosje).
        </p>
        <div className="mt-4">
          <ItemListEditor items={rules.always} onChange={setAlways} />
        </div>
      </section>

      <DeliveryBlockEditor
        title="Rijklaar-fietsen"
        description='Geldt wanneer Levering op "Volledig rijklaar" staat (webshop of Marktplaats).'
        block={rules.volledigRijklaar}
        onChange={(volledigRijklaar) => onChange({ ...rules, volledigRijklaar })}
      />

      <DeliveryBlockEditor
        title="In-doos-fietsen"
        description='Zelfde opbouw, wanneer Levering op "In doos" staat.'
        block={rules.inDoos}
        onChange={(inDoos) => onChange({ ...rules, inDoos })}
      />
    </div>
  );
}
