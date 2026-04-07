"use client";

import Link from "next/link";
import Header from "@/components/Header";

export default function PaklijstKeuzePage() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-8 flex items-center gap-4">
            <Link
              href="/"
              className="text-koopje-black/60 transition hover:text-koopje-black"
              aria-label="Terug"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Paklijst kiezen</h1>
              <p className="mt-1 text-sm text-koopje-black/60">
                Kies welk type paklijst je wilt genereren.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/paklijst"
              className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-koopje-orange/50 hover:shadow-md"
            >
              <h2 className="text-base font-semibold text-koopje-black">Bezorging</h2>
              <p className="mt-1 text-sm text-koopje-black/60">
                Bestaande paklijst voor ritjes/planning.
              </p>
            </Link>

            <Link
              href="/paklijst/pakketjes"
              className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-koopje-orange/50 hover:shadow-md"
            >
              <h2 className="text-base font-semibold text-koopje-black">Pakketjes</h2>
              <p className="mt-1 text-sm text-koopje-black/60">
                Automatisch via Shopify-webhook: orders onder €500 in de wachtrij.
              </p>
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

