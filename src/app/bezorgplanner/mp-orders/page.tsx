import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, isAllowedEmail, normalizeEmail } from "@/lib/auth-shared";
import { createServerSupabaseClient } from "@/lib/supabase";
import { isMpPausedForOwner } from "@/lib/mp-pause";
import MpOrdersClient from "./MpOrdersClient";

export default async function MpOrdersPage() {
  const cookieStore = await cookies();
  const email = normalizeEmail(cookieStore.get(AUTH_COOKIE)?.value ?? "");
  const ownerEmail = isAllowedEmail(email) ? email : null;
  const mpPaused = ownerEmail
    ? await isMpPausedForOwner(createServerSupabaseClient(), ownerEmail)
    : false;

  // MP-veiligheidsschakelaar: deze pagina bestaat dan "niet" — geen lege lijst/melding, geen spoor.
  if (mpPaused) redirect("/afgeronde-orders");

  return <MpOrdersClient />;
}
