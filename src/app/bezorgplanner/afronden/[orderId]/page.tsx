import Link from "next/link";
import Header from "@/components/Header";

/**
 * Placeholder voor de vragenlijst bij afronden van een order.
 * Wordt later ingevuld.
 */
export default function AfrondenVragenlijstPage({
  params,
}: {
  params: { orderId: string };
}) {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/bezorgplanner/planning"
              className="text-koopje-black/60 transition hover:text-koopje-black"
              aria-label="Terug naar Planning"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
              Order afronden
            </h1>
          </div>
          <p className="text-koopje-black/70">
            Vragenlijst voor order <strong>{params.orderId}</strong> komt hier. (Wordt later toegevoegd.)
          </p>
        </div>
      </main>
    </>
  );
}
