import Link from "next/link";
import Header from "@/components/Header";

export default function Home() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
          <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
            Dashboard
          </h1>
          <p className="mt-1 text-koopje-black/60 sm:mt-2">
            Kies een actie om te starten.
          </p>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            <li>
              <Link
                href="/bezorgplanner"
                className="group flex flex-col rounded-xl border border-koopje-black/10 bg-white p-6 shadow-sm transition hover:border-koopje-orange hover:shadow-md focus:outline-none focus:ring-2 focus:ring-koopje-orange focus:ring-offset-2"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-koopje-orange-light text-koopje-orange transition group-hover:bg-koopje-orange group-hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </span>
                <span className="mt-4 font-medium text-koopje-black">Bezorgplanner</span>
                <span className="mt-1 text-sm text-koopje-black/60">Planning bekijken, ritjes voor vandaag en bezorgde orders</span>
              </Link>
            </li>

            <li>
              <Link
                href="/marktplaats/nieuw"
                className="group flex flex-col rounded-xl border border-koopje-black/10 bg-white p-6 shadow-sm transition hover:border-koopje-orange hover:shadow-md focus:outline-none focus:ring-2 focus:ring-koopje-orange focus:ring-offset-2"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-koopje-orange-light text-koopje-orange transition group-hover:bg-koopje-orange group-hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </span>
                <span className="mt-4 font-medium text-koopje-black">Nieuwe Marktplaats order</span>
                <span className="mt-1 text-sm text-koopje-black/60">Formulier voor afhaal of bezorging</span>
              </Link>
            </li>

            <li>
              <Link
                href="/paklijst-keuze"
                className="group flex flex-col rounded-xl border border-koopje-black/10 bg-white p-6 shadow-sm transition hover:border-koopje-orange hover:shadow-md focus:outline-none focus:ring-2 focus:ring-koopje-orange focus:ring-offset-2"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-koopje-orange-light text-koopje-orange transition group-hover:bg-koopje-orange group-hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </span>
                <span className="mt-4 font-medium text-koopje-black">Paklijst genereren</span>
                <span className="mt-1 text-sm text-koopje-black/60">Accessoires en standaardproducten voor vandaag</span>
              </Link>
            </li>

            <li>
              <Link
                href="/afgeronde-orders"
                className="group flex flex-col rounded-xl border border-koopje-black/10 bg-white p-6 shadow-sm transition hover:border-koopje-orange hover:shadow-md focus:outline-none focus:ring-2 focus:ring-koopje-orange focus:ring-offset-2"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-koopje-orange-light text-koopje-orange transition group-hover:bg-koopje-orange group-hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span className="mt-4 font-medium text-koopje-black">Afgeronde orders</span>
                <span className="mt-1 text-sm text-koopje-black/60">Bezorgde orders en MP orders</span>
              </Link>
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}
