import crypto from "crypto";
import nodemailer from "nodemailer";
import { createServerSupabaseClient } from "@/lib/supabase";
import { AUTH_COOKIE, ALLOWED_USERS, isAllowedEmail, normalizeEmail } from "@/lib/auth-shared";

type AllowedEmail = (typeof ALLOWED_USERS)[number]["email"];
export { AUTH_COOKIE, ALLOWED_USERS, isAllowedEmail, normalizeEmail };

function sha(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function passwordHash(password: string): string {
  const salt = process.env.AUTH_PASSWORD_SALT ?? "koopje-auth-salt";
  return sha(`${salt}:${password}`);
}

function settingKeyForEmail(email: string): string {
  return `auth_pw_${normalizeEmail(email).replaceAll(/[^a-z0-9]/g, "_")}`;
}

export async function getStoredPasswordHash(email: string): Promise<string | null> {
  const supabase = createServerSupabaseClient();
  const key = settingKeyForEmail(email);
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  const value = data?.value;
  return value ? String(value) : null;
}

export async function setPassword(email: string, newPassword: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const key = settingKeyForEmail(email);
  await supabase.from("settings").upsert({ key, value: passwordHash(newPassword) });
}

export async function verifyCredentials(emailRaw: string, passwordRaw: string): Promise<boolean> {
  const email = normalizeEmail(emailRaw);
  const password = String(passwordRaw ?? "");
  if (!isAllowedEmail(email)) return false;

  const stored = await getStoredPasswordHash(email);
  if (stored) return stored === passwordHash(password);

  const defaultUser = ALLOWED_USERS.find((u) => u.email === email);
  return defaultUser?.defaultPassword === password;
}

function signResetPayload(payload: string): string {
  const secret = process.env.AUTH_RESET_SECRET ?? "koopje-reset-secret";
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function createResetToken(emailRaw: string): string {
  const email = normalizeEmail(emailRaw);
  const exp = Date.now() + 1000 * 60 * 30; // 30 min geldig
  const payloadObj = { email, exp };
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = signResetPayload(payload);
  return `${payload}.${sig}`;
}

export function verifyResetToken(token: string): { ok: boolean; email?: string; error?: string } {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return { ok: false, error: "Ongeldige token." };
  const expected = signResetPayload(payload);
  if (sig !== expected) return { ok: false, error: "Ongeldige handtekening." };
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      exp?: number;
    };
    const email = normalizeEmail(decoded.email ?? "");
    if (!isAllowedEmail(email)) return { ok: false, error: "Email niet toegestaan." };
    if (!decoded.exp || decoded.exp < Date.now()) return { ok: false, error: "Token verlopen." };
    return { ok: true, email };
  } catch {
    return { ok: false, error: "Token kan niet gelezen worden." };
  }
}

export async function sendResetEmail(email: string, token: string): Promise<void> {
  const from = process.env.GMAIL_FROM;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!from || !pass) {
    throw new Error("GMAIL_FROM of GMAIL_APP_PASSWORD ontbreekt.");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const resetUrl = `${appUrl}/reset-wachtwoord?token=${encodeURIComponent(token)}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: from, pass },
  });

  await transporter.sendMail({
    from: `Koopjefatbike <${from}>`,
    to: email,
    subject: "Wachtwoord reset - Bezorgplanner",
    html: `
      <p>Hallo,</p>
      <p>Je hebt een wachtwoord-reset aangevraagd voor Bezorgplanner.</p>
      <p><a href="${resetUrl}">Klik hier om je wachtwoord te resetten</a></p>
      <p>Deze link is 30 minuten geldig.</p>
    `,
  });
}

