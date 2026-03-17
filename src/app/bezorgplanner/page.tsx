import Link from "next/link";
import Header from "@/components/Header";

export default function BezorgplannerPage() {
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
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Bezorgplanner</h1>
          </div>

          {/* Actieve planning */}
          <div className="mb-10">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-koopje-black/40">
              Actieve planning
            </p>
            <ul className="grid gap-4 sm:grid-cols-2">
              <li>
                <Link
                  href="/bezorgplanner/ritjes-vandaag"
                  className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
                >
                  <span className="font-medium text-koopje-black">Ritjes voor vandaag</span>
                  <span className="mt-1 block text-sm text-koopje-black/60">Orders die vandaag gepland staan</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/bezorgplanner/planning"
                  className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
                >
                  <span className="font-medium text-koopje-black">Planning</span>
                  <span className="mt-1 block text-sm text-koopje-black/60">Route en tijdsloten voor de dag</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Afgeronde orders */}
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-koopje-black/40">
              Afgeronde orders
            </p>
            <ul className="grid gap-4 sm:grid-cols-2">
              <li>
                <Link
                  href="/bezorgplanner/bezorgde-orders"
                  className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
                >
                  <span className="font-medium text-koopje-black">Bezorgde orders</span>
                  <span className="mt-1 block text-sm text-koopje-black/60">Afgeronde bezorgingen (Shopify)</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/bezorgplanner/mp-orders"
                  className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
                >
                  <span className="font-medium text-koopje-black">MP orders</span>
                  <span className="mt-1 block text-sm text-koopje-black/60">Marktplaats-orders (bezorgd en winkel)</span>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </main>
    </>
  );
}
