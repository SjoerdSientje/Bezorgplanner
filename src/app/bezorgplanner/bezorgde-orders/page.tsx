import Link from "next/link";
import Header from "@/components/Header";
import EditableSheetTable from "@/components/EditableSheetTable";

const BEZORGDE_ORDERS_HEADERS = [
  "Order Nummer",
  "Naam",
  "Bezorger",
  "Hoe is er betaald?",
  "Betaald bedrag",
  "Bezorg Datum",
  "Product(en)",
  "Bestelling Totaal Prijs",
  "Volledig adress",
  "Telefoon nummer",
  "Order ID",
  "Aantal fietsen",
  "Email",
  "Betaalmethode",
  "Nummer in E.164 formaat",
];

export default function BezorgdeOrdersPage() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/afgeronde-orders"
              className="text-koopje-black/60 transition hover:text-koopje-black"
              aria-label="Terug"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">
              Bezorgde orders
            </h1>
          </div>

          <p className="mb-4 text-sm text-koopje-black/60">
            Onderstaande tabel toont alle kolommen. Je kunt in elk vakje typen. Scroll horizontaal als niet alles past.
          </p>

          <EditableSheetTable headers={BEZORGDE_ORDERS_HEADERS} />
        </div>
      </main>
    </>
  );
}
