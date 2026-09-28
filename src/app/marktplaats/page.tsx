import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { AUTH_COOKIE, isAllowedEmail, normalizeEmail } from "@/lib/auth-shared";
import { createServerSupabaseClient } from "@/lib/supabase";
import { isMpPausedForOwner } from "@/lib/mp-pause";

export default async function MarktplaatsHubPage() {
  const cookieStore = await cookies();
  const email = normalizeEmail(cookieStore.get(AUTH_COOKIE)?.value ?? "");
  const ownerEmail = isAllowedEmail(email) ? email : null;
  const mpPaused = ownerEmail
    ? await isMpPausedForOwner(createServerSupabaseClient(), ownerEmail)
    : false;

  if (mpPaused) redirect("/");

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
            <h1 className="text-xl font-semibold text-koopje-black sm:text-2xl">Marktplaats orders</h1>
          </div>

          <p className="text-koopje-black/70">
            Afhaal- en bezorgorders aanmaken, of geplande MP-orders bekijken en bewerken.
          </p>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <Link
                href="/marktplaats/nieuw?soort=afhaal"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Afgehaald</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Nieuwe afhaalorder (winkelverkoop)
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/marktplaats/nieuw?soort=bezorging"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Bezorgen</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Nieuwe bezorgorder (ritjes vandaag)
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/marktplaats/gepland"
                className="block rounded-xl border border-koopje-black/10 bg-white p-5 shadow-sm transition hover:border-koopje-orange hover:shadow"
              >
                <span className="font-medium text-koopje-black">Geplande MP orders</span>
                <span className="mt-1 block text-sm text-koopje-black/60">
                  Orders in ritjes vandaag / planning bewerken
                </span>
              </Link>
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}
