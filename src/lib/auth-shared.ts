export const AUTH_COOKIE = "bp_auth_email";

export const ALLOWED_USERS = [
  { email: "info@koopjefatbike.nl", defaultPassword: "0814" },
  { email: "malyar@aiventive.nl", defaultPassword: "123456" },
] as const;

export function normalizeEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return ALLOWED_USERS.some((u) => u.email === e);
}

