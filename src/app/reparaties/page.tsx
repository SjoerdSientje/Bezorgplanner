import Link from "next/link";
import Header from "@/components/Header";

export default function ReparatiesHubPage() {
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
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Reparaties</h1>
          </div>

          <p className="text-koopje-black/70">
            Prijzenlijst, nieuwe reparatie/ophalen/brengen-orders en geplande reparaties.
          </p>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <Link
                href="/reparaties/prijzenlijst"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Prijzenlijst reparaties</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Standaardreparaties en voorrijkosten bewerken
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/reparaties/nieuw"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Reparatie aanmaken</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Reparatie aan huis, ophalen of terugbrengen
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/reparaties/gepland"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Geplande reparaties</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Openstaande reparatie-orders bekijken en bewerken
                </span>
              </Link>
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}
