import Link from "next/link";
import Header from "@/components/Header";

export default function PaklijstPage() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/"
              className="text-koopje-black/60 transition hover:text-koopje-black"
              aria-label="Terug naar dashboard"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
              Paklijst genereren
            </h1>
          </div>

          <div className="rounded-xl border border-koopje-orange/30 bg-koopje-orange-light/50 p-6 text-koopje-black">
            <p className="font-medium">Binnenkort beschikbaar</p>
            <p className="mt-2 text-sm text-koopje-black/80">
              Deze functie wordt later toegevoegd. Je kunt terug naar het
              dashboard om iets anders te doen.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-koopje-orange-dark underline hover:no-underline"
            >
              Naar dashboard
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
