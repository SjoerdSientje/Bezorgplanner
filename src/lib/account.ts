import { NextRequest } from "next/server";
import { AUTH_COOKIE, isAllowedEmail, normalizeEmail, ALLOWED_USERS } from "@/lib/auth-shared";

export function getAccountEmailFromRequest(request: NextRequest): string | null {
  const raw = request.cookies.get(AUTH_COOKIE)?.value ?? "";
  const email = normalizeEmail(raw);
  if (!email || !isAllowedEmail(email)) return null;
  return email;
}

export function requireAccountEmail(request: NextRequest): string {
  const email = getAccountEmailFromRequest(request);
  if (!email) {
    throw new Error("Niet ingelogd of ongeldig account.");
  }
  return email;
}

export function allAccountEmails(): string[] {
  return ALLOWED_USERS.map((u) => u.email);
}

/** Shopify-import voor dit account alleen als de order-notitie dit bevat (case-insensitive). */
const MALYAR_ACCOUNT = "malyar@aiventive.nl";
const MALYAR_NOTE_REQUIRED_SUBSTRING = "malyar";

/**
 * Bepaalt of een binnenkomende Shopify-webhook voor `ownerEmail` een order mag aanmaken/updaten.
 * Het account malyar@ krijgt alleen orders waar "Malyar" in de ordernote staat; overige accounts ongewijzigd.
 */
export function shopifyWebhookOrderAppliesToOwner(
  ownerEmail: string,
  orderNote: string | null | undefined
): boolean {
  if (normalizeEmail(ownerEmail) !== normalizeEmail(MALYAR_ACCOUNT)) {
    return true;
  }
  return String(orderNote ?? "").toLowerCase().includes(MALYAR_NOTE_REQUIRED_SUBSTRING);
}
