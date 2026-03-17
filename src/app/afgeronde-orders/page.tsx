import Link from "next/link";
import Header from "@/components/Header";

export default function AfgerdondeOrdersPage() {
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
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Afgeronde orders</h1>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2">
            <li>
              <Link
                href="/bezorgplanner/bezorgde-orders"
                className="group flex flex-col rounded-xl border border-koopje-black/10 bg-white p-6 shadow-sm transition hover:border-koopje-orange hover:shadow-md focus:outline-none focus:ring-2 focus:ring-koopje-orange focus:ring-offset-2"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-koopje-orange-light text-koopje-orange transition group-hover:bg-koopje-orange group-hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </span>
                <span className="mt-4 font-medium text-koopje-black">Bezorgde orders</span>
                <span className="mt-1 text-sm text-koopje-black/60">Afgeronde bezorgingen (Shopify)</span>
              </Link>
            </li>

            <li>
              <Link
                href="/bezorgplanner/mp-orders"
                className="group flex flex-col rounded-xl border border-koopje-black/10 bg-white p-6 shadow-sm transition hover:border-koopje-orange hover:shadow-md focus:outline-none focus:ring-2 focus:ring-koopje-orange focus:ring-offset-2"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-koopje-orange-light text-koopje-orange transition group-hover:bg-koopje-orange group-hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </span>
                <span className="mt-4 font-medium text-koopje-black">MP orders</span>
                <span className="mt-1 text-sm text-koopje-black/60">Marktplaats-orders (bezorgd en winkel)</span>
              </Link>
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}
