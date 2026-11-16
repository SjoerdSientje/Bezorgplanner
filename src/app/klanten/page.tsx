import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { AUTH_COOKIE, isAllowedEmail, normalizeEmail } from "@/lib/auth-shared";
import KlantenClient from "./KlantenClient";

export default async function KlantenPage() {
  const cookieStore = await cookies();
  const email = normalizeEmail(cookieStore.get(AUTH_COOKIE)?.value ?? "");
  if (!isAllowedEmail(email)) redirect("/");

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-white">
        <KlantenClient />
      </main>
    </>
  );
}
