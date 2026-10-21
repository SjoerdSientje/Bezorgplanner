"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterHandleidingSections,
  type HandleidingSection,
} from "@/lib/handleiding-content";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function HandleidingModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => filterHandleidingSections(query), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveId(null);
    const t = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function scrollToSection(id: string) {
    setActiveId(id);
    const el = document.getElementById(`handleiding-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="handleiding-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="border-b border-stone-200 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="handleiding-title"
                className="text-base font-semibold text-koopje-black sm:text-lg"
              >
                Handleiding
              </h2>
              <p className="text-xs text-stone-500 sm:text-sm">
                Kort en duidelijk — zoek hierboven als je iets snel nodig hebt.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100"
              aria-label="Sluiten"
            >
              ✕
            </button>
          </div>

          <label className="mt-3 block">
            <span className="sr-only">Zoeken in handleiding</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek: shopify, factuur, voorraad, reparatie…"
              className="w-full rounded-xl border border-koopje-black/15 bg-stone-50 px-3 py-2.5 text-sm text-koopje-black placeholder:text-stone-400 focus:border-koopje-orange focus:bg-white focus:outline-none focus:ring-1 focus:ring-koopje-orange"
            />
          </label>

          <nav
            className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5"
            aria-label="Onderdelen"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToSection(s.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                  activeId === s.id
                    ? "bg-koopje-black text-white"
                    : "bg-stone-100 text-koopje-black/80 hover:bg-stone-200"
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>
        </div>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          {sections.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">
              Niets gevonden. Probeer een ander woord.
            </p>
          ) : (
            <div className="space-y-8">
              {sections.map((section) => (
                <SectionView key={section.id} section={section} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionView({ section }: { section: HandleidingSection }) {
  return (
    <section id={`handleiding-${section.id}`} className="scroll-mt-3">
      <h3 className="mb-3 border-b border-stone-100 pb-2 text-sm font-semibold uppercase tracking-wide text-koopje-orange">
        {section.title}
      </h3>
      <ul className="space-y-4">
        {section.blocks.map((block, i) => (
          <li key={`${section.id}-${i}`}>
            {block.heading ? (
              <p className="mb-1 text-sm font-semibold text-koopje-black">
                {block.heading}
              </p>
            ) : null}
            <p className="whitespace-pre-line text-sm leading-relaxed text-koopje-black/80">
              {block.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
