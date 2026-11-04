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

/** Gedeeld voorraadaccount voor QR-scan in de winkel (niet per ingelogde gebruiker). */
export function getInventoryScanOwnerEmail(): string {
  const fromEnv = process.env.INVENTORY_SCAN_OWNER_EMAIL?.trim();
  if (fromEnv && isAllowedEmail(fromEnv)) return normalizeEmail(fromEnv);
  return normalizeEmail("info@koopjefatbike.nl");
}

/**
 * Voorraad in de ingelogde app: altijd het account van de sessie.
 * Zo blijven malyar@ en info@ gescheiden (stock, opmerkingen, drempels, pending).
 * Winkel-QR-scan/zoeken moet expliciet `getInventoryScanOwnerEmail()` gebruiken.
 */
export function getInventoryOwnerEmail(request: NextRequest): string {
  const email = getAccountEmailFromRequest(request);
  if (email) return email;
  return getInventoryScanOwnerEmail();
}

export function allAccountEmails(): string[] {
  return ALLOWED_USERS.map((u) => u.email);
}

/** Shopify-import voor dit account alleen als de order-notitie dit bevat (case-insensitive). */
const MALYAR_ACCOUNT = "malyar@aiventive.nl";
const MALYAR_NOTE_REQUIRED_SUBSTRING = "malyar";

/** Alleen dit nummer mag WhatsApp ontvangen als het verzoek vanaf het malyar-account komt. */
export const MALYAR_WHATSAPP_ALLOWED_RECIPIENT = "31627182453";

export function isMalyarAccount(email: string | null | undefined): boolean {
  return normalizeEmail(email ?? "") === normalizeEmail(MALYAR_ACCOUNT);
}

/** Testaccount mag Shopify-metafields (levertijd/restock) niet aanpassen. */
export function mayPushInventoryMetafieldsToShopify(
  ownerEmail: string | null | undefined
): boolean {
  return !isMalyarAccount(ownerEmail);
}

/** Testaccount mag geen Moneybird-conceptfacturen aanmaken/bijwerken. */
export function mayCreateMoneybirdInvoicesForOwner(
  ownerEmail: string | null | undefined
): boolean {
  return !isMalyarAccount(ownerEmail);
}

/** Testorders: "malyar" ergens in de Shopify order note (case-insensitive). */
export function isMalyarTestOrderNote(orderNote: string | null | undefined): boolean {
  return String(orderNote ?? "").toLowerCase().includes(MALYAR_NOTE_REQUIRED_SUBSTRING);
}

/**
 * Bepaalt of een binnenkomende Shopify-webhook voor `ownerEmail` een order mag aanmaken/updaten.
 * Orders met "malyar" in de note gaan alleen naar malyar@; overige orders nooit naar malyar@.
 */
export function shopifyWebhookOrderAppliesToOwner(
  ownerEmail: string,
  orderNote: string | null | undefined
): boolean {
  const isMalyarOwner = isMalyarAccount(ownerEmail);
  const isMalyarNote = isMalyarTestOrderNote(orderNote);
  if (isMalyarNote) return isMalyarOwner;
  return !isMalyarOwner;
}

/** Zelfde logica als `normalizePhone` in whatsapp.ts (voor vergelijken met toegestaan nummer). */
function normalizePhoneDigitsForCompare(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("00")) return cleaned.slice(2);
  if (cleaned.startsWith("0")) return `31${cleaned.slice(1)}`;
  if (cleaned.startsWith("31")) return cleaned;
  return cleaned;
}

export type WhatsAppOwnerGateResult = { ok: true } | { ok: false; error: string };

/**
 * Beperkt WhatsApp voor malyar@: alleen naar +31627182453. Andere accounts: geen restrictie.
 * `ownerEmail` moet worden doorgegeven vanuit API-routes (ingelogde gebruiker).
 */
export function maySendWhatsAppForOwner(
  ownerEmail: string | null | undefined,
  order: { telefoon_e164?: string | null; telefoon_nummer?: string | null }
): WhatsAppOwnerGateResult {
  if (!isMalyarAccount(ownerEmail)) {
    return { ok: true };
  }
  const to = normalizePhoneDigitsForCompare(order.telefoon_e164 || order.telefoon_nummer || "");
  if (to === MALYAR_WHATSAPP_ALLOWED_RECIPIENT) {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      "Geen toestemming: vanaf dit account mogen appjes alleen naar +31627182453.",
  };
}
