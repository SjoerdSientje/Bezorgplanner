import Link from "next/link";
import Header from "@/components/Header";

export default function VoorraadbeheerPage() {
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
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Voorraadbeheer</h1>
          </div>

          <p className="text-koopje-black/70">Voorraad, inkomende leveringen en standaard meegeleverde items.</p>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            <li>
              <Link
                href="/voorraadbeheer/voorraad"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Voorraad</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Voorraad bijhouden, mutaties en inkomende leveringen
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/voorraadbeheer/standaard-inbegrepen"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Standaard inbegrepen</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Wat hoort automatisch bij een fiets (levering en model)
                </span>
              </Link>
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}
