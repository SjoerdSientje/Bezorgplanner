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
