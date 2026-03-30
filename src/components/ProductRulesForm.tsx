"use client";

import type { ProductDefaultItemsRulesV1 } from "@/lib/product-default-items-rules";

function parseLines(text: string): string[] {
  // Bewaar invoer exact tijdens typen; opschonen gebeurt pas bij verwerken.
  return text.split(/\r?\n/);
}

function joinLines(arr: string[]): string {
  return arr.join("\n");
}

type Props = {
  rules: ProductDefaultItemsRulesV1;
  onChange: (next: ProductDefaultItemsRulesV1) => void;
};

export default function ProductRulesForm({ rules, onChange }: Props) {
  const setAlways = (text: string) => {
    onChange({ ...rules, always: parseLines(text) });
  };
  const setExcluded = (text: string) => {
    onChange({ ...rules, excludedBrandKeywords: parseLines(text) });
  };

  const setVrStandard = (text: string) => {
    onChange({
      ...rules,
      volledigRijklaar: {
        ...rules.volledigRijklaar,
        standardItems: parseLines(text),
      },
    });
  };

  const setIdStandard = (text: string) => {
    onChange({
      ...rules,
      inDoos: { ...rules.inDoos, standardItems: parseLines(text) },
    });
  };

  const updateVrExtra = (
    index: number,
    field: "models" | "items",
    text: string
  ) => {
    const next = [...rules.volledigRijklaar.modelExtras];
    const row = { ...next[index], [field]: parseLines(text) };
    next[index] = row;
    onChange({
      ...rules,
      volledigRijklaar: { ...rules.volledigRijklaar, modelExtras: next },
    });
  };

  const addVrExtra = () => {
    onChange({
      ...rules,
      volledigRijklaar: {
        ...rules.volledigRijklaar,
        modelExtras: [...rules.volledigRijklaar.modelExtras, { models: [], items: [] }],
      },
    });
  };

  const removeVrExtra = (index: number) => {
    onChange({
      ...rules,
      volledigRijklaar: {
        ...rules.volledigRijklaar,
        modelExtras: rules.volledigRijklaar.modelExtras.filter((_, i) => i !== index),
      },
    });
  };

  const updateIdExtra = (
    index: number,
    field: "models" | "items",
    text: string
  ) => {
    const next = [...rules.inDoos.modelExtras];
    const row = { ...next[index], [field]: parseLines(text) };
    next[index] = row;
    onChange({
      ...rules,
      inDoos: { ...rules.inDoos, modelExtras: next },
    });
  };

  const addIdExtra = () => {
    onChange({
      ...rules,
      inDoos: {
        ...rules.inDoos,
        modelExtras: [...rules.inDoos.modelExtras, { models: [], items: [] }],
      },
    });
  };

  const removeIdExtra = (index: number) => {
    onChange({
      ...rules,
      inDoos: {
        ...rules.inDoos,
        modelExtras: rules.inDoos.modelExtras.filter((_, i) => i !== index),
      },
    });
  };

  const fieldClass =
    "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-koopje-black placeholder:text-stone-400 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange/40";

  const labelClass = "text-sm font-medium text-koopje-black";

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-koopje-black">
          Altijd bij elke fiets
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Deze spullen worden altijd getoond bij &quot;Standaard inbegrepen&quot;, ongeacht
          hoe de fiets geleverd wordt. Typ <span className="font-mono text-stone-800">{`{model}`}</span>{" "}
          als de naam van het model automatisch ingevuld moet worden (zoals op de
          paklijst).
        </p>
        <label className={`${labelClass} mt-4 block`}>Regels (één item per regel)</label>
        <textarea
          value={joinLines(rules.always)}
          onChange={(e) => setAlways(e.target.value)}
          rows={4}
          spellCheck={false}
          className={`${fieldClass} font-mono text-xs sm:text-sm`}
        />
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-koopje-black">
          Merken zonder standaard slot / tas
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Als de productnaam een van deze woorden bevat, worden de <em>extra</em> standaard
          items voor &quot;Volledig rijklaar&quot; en &quot;In doos&quot; (zoals kettingslot) niet
          automatisch toegevoegd. Handig voor merken die anders geleverd worden.
        </p>
        <label className={`${labelClass} mt-4 block`}>Trefwoorden (één per regel, kleine letters mag)</label>
        <textarea
          value={joinLines(rules.excludedBrandKeywords)}
          onChange={(e) => setExcluded(e.target.value)}
          rows={3}
          spellCheck={false}
          className={`${fieldClass} font-mono text-xs sm:text-sm`}
        />
      </section>

      <section className="rounded-xl border border-koopje-orange/25 bg-orange-50/40 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-koopje-black">
          Levering: volledig rijklaar
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Geldt wanneer bij de fiets <strong>Levering</strong> op &quot;Volledig rijklaar&quot;
          staat (zoals bij de webshop of Marktplaats-order).
        </p>

        <label className={`${labelClass} mt-4 block`}>
          Standaard voor bijna alle fietsen (één item per regel)
        </label>
        <textarea
          value={joinLines(rules.volledigRijklaar.standardItems)}
          onChange={(e) => setVrStandard(e.target.value)}
          rows={4}
          spellCheck={false}
          className={`${fieldClass} font-mono text-xs sm:text-sm`}
        />

        <h3 className="mt-6 text-sm font-semibold text-koopje-black">
          Extra alleen voor bepaalde modellen
        </h3>
        <p className="mt-1 text-sm text-stone-600">
          Voeg een blok toe per groep modellen. De modelnaam moet exact overeenkomen met
          wat het systeem uit de producttitel haalt (hoofdletters maakt niet uit).
        </p>

        <div className="mt-4 space-y-4">
          {rules.volledigRijklaar.modelExtras.map((g, i) => (
            <div
              key={i}
              className="rounded-lg border border-stone-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-stone-800">Groep {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeVrExtra(i)}
                  className="text-sm text-red-700 underline decoration-red-700/40 hover:decoration-red-700"
                >
                  Groep verwijderen
                </button>
              </div>
              <label className={`${labelClass} mt-3 block`}>Modellen (één per regel)</label>
              <textarea
                value={joinLines(g.models)}
                onChange={(e) => updateVrExtra(i, "models", e.target.value)}
                rows={3}
                spellCheck={false}
                className={`${fieldClass} font-mono text-xs sm:text-sm`}
              />
              <label className={`${labelClass} mt-3 block`}>Extra items (één per regel)</label>
              <textarea
                value={joinLines(g.items)}
                onChange={(e) => updateVrExtra(i, "items", e.target.value)}
                rows={3}
                spellCheck={false}
                className={`${fieldClass} font-mono text-xs sm:text-sm`}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addVrExtra}
          className="mt-4 rounded-lg border border-dashed border-koopje-orange/50 bg-white px-4 py-2 text-sm font-medium text-koopje-black hover:bg-orange-50/80"
        >
          + Nieuwe modelgroep
        </button>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-koopje-black">
          Levering: in doos
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Zelfde idee als hierboven, maar wanneer Levering op &quot;In doos&quot; staat.
        </p>

        <label className={`${labelClass} mt-4 block`}>
          Standaard voor bijna alle fietsen (één item per regel)
        </label>
        <textarea
          value={joinLines(rules.inDoos.standardItems)}
          onChange={(e) => setIdStandard(e.target.value)}
          rows={4}
          spellCheck={false}
          className={`${fieldClass} font-mono text-xs sm:text-sm`}
        />

        <h3 className="mt-6 text-sm font-semibold text-koopje-black">
          Extra alleen voor bepaalde modellen
        </h3>
        <div className="mt-4 space-y-4">
          {rules.inDoos.modelExtras.map((g, i) => (
            <div
              key={i}
              className="rounded-lg border border-stone-200 bg-stone-50/80 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-stone-800">Groep {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeIdExtra(i)}
                  className="text-sm text-red-700 underline decoration-red-700/40 hover:decoration-red-700"
                >
                  Groep verwijderen
                </button>
              </div>
              <label className={`${labelClass} mt-3 block`}>Modellen (één per regel)</label>
              <textarea
                value={joinLines(g.models)}
                onChange={(e) => updateIdExtra(i, "models", e.target.value)}
                rows={3}
                spellCheck={false}
                className={`${fieldClass} font-mono text-xs sm:text-sm`}
              />
              <label className={`${labelClass} mt-3 block`}>Extra items (één per regel)</label>
              <textarea
                value={joinLines(g.items)}
                onChange={(e) => updateIdExtra(i, "items", e.target.value)}
                rows={3}
                spellCheck={false}
                className={`${fieldClass} font-mono text-xs sm:text-sm`}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addIdExtra}
          className="mt-4 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-2 text-sm font-medium text-koopje-black hover:bg-stone-50"
        >
          + Nieuwe modelgroep
        </button>
      </section>
    </div>
  );
}
