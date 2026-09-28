import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, isAllowedEmail, normalizeEmail } from "@/lib/auth-shared";
import { createServerSupabaseClient } from "@/lib/supabase";
import { isMpPausedForOwner } from "@/lib/mp-pause";
import MarktplaatsGeplandClient from "./GeplandClient";

export default async function MarktplaatsGeplandPage() {
  const cookieStore = await cookies();
  const email = normalizeEmail(cookieStore.get(AUTH_COOKIE)?.value ?? "");
  const ownerEmail = isAllowedEmail(email) ? email : null;
  const mpPaused = ownerEmail
    ? await isMpPausedForOwner(createServerSupabaseClient(), ownerEmail)
    : false;

  if (mpPaused) redirect("/");

  return <MarktplaatsGeplandClient />;
}
