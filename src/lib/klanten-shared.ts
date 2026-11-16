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
  voornaam: string;
  achternaam: string;
  telefoon: string;
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  bronnen: KlantBronnen;
  moneybirdId: string | null;
  mpOrderId: string | null;
};

/** Zoeken: alleen prefix-match op voornaam, achternaam of e-mail. */
export function klantMatchesSearchPrefix(klant: Klant, query: string): boolean {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  return (
    klant.email.toLowerCase().startsWith(needle) ||
    klant.voornaam.toLowerCase().startsWith(needle) ||
    klant.achternaam.toLowerCase().startsWith(needle)
  );
}

export function splitNaamToVoorAchternaam(naam: string): {
  voornaam: string;
  achternaam: string;
} {
  const parts = String(naam ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { voornaam: "", achternaam: "" };
  if (parts.length === 1) return { voornaam: parts[0]!, achternaam: "" };
  return {
    voornaam: parts[0]!,
    achternaam: parts.slice(1).join(" "),
  };
}

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
