/** Client-veilige klanttypes voor de klantenpagina. */

export type KlantBronnen = {
  moneybird: boolean;
  mp: boolean;
};

export type Klant = {
  /** Stabiele id: `mb:{moneybirdId}` of `mp:{orderId}`. */
  id: string;
  email: string;
  naam: string;
  telefoon: string;
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  bronnen: KlantBronnen;
  moneybirdId: string | null;
  mpOrderId: string | null;
};

export function encodeKlantId(kind: "mb" | "mp", rawId: string): string {
  return `${kind}:${String(rawId ?? "").trim()}`;
}

export function parseKlantId(
  id: string
): { kind: "mb" | "mp"; rawId: string } | null {
  const raw = String(id ?? "").trim();
  const m = raw.match(/^(mb|mp):(.+)$/);
  if (!m) return null;
  return { kind: m[1] as "mb" | "mp", rawId: m[2]! };
}
