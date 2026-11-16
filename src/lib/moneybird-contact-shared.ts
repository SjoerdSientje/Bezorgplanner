/** Client-veilige Moneybird contact helpers (geen server/API imports). */

export type ContactSuggestionSource = "moneybird" | "mp";

export type MoneybirdContactSuggestion = {
  id: string;
  email: string;
  displayName: string;
  firstname: string;
  lastname: string;
  companyName: string;
  phone: string;
  address1: string;
  zipcode: string;
  city: string;
  /** moneybird = MB-klant; mp = klant uit afgeronde MP-order (geen MB-update). */
  source?: ContactSuggestionSource;
};

/** Formuliervelden die uit een Moneybird-klant komen / ernaartoe gaan. */
export type MoneybirdContactFormFill = {
  email: string;
  naam: string;
  telefoon: string;
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  /** Alleen 'moneybird' triggert bevestiging/update in reparatieflow. */
  source?: ContactSuggestionSource;
};

function normField(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function moneybirdContactFillsEqual(
  a: MoneybirdContactFormFill,
  b: MoneybirdContactFormFill
): boolean {
  return (
    normField(a.email).toLowerCase() === normField(b.email).toLowerCase() &&
    normField(a.naam) === normField(b.naam) &&
    normField(a.telefoon) === normField(b.telefoon) &&
    normField(a.straatnaam) === normField(b.straatnaam) &&
    normField(a.huisnummer) === normField(b.huisnummer) &&
    normField(a.postcode).toLowerCase() === normField(b.postcode).toLowerCase() &&
    normField(a.woonplaats) === normField(b.woonplaats)
  );
}

/** Bevestigingstekst als formuliervelden afwijken van de gekozen Moneybird-klant. */
export function moneybirdContactUpdateConfirmMessage(
  original: MoneybirdContactFormFill,
  current: MoneybirdContactFormFill
): string {
  const labels: Array<[keyof MoneybirdContactFormFill, string]> = [
    ["email", "E-mail"],
    ["naam", "Naam"],
    ["telefoon", "Telefoon"],
    ["straatnaam", "Straat"],
    ["huisnummer", "Huisnummer"],
    ["postcode", "Postcode"],
    ["woonplaats", "Woonplaats"],
  ];
  const changes: string[] = [];
  for (const [key, label] of labels) {
    const before = normField(original[key]);
    const after = normField(current[key]);
    const beforeCmp = key === "email" || key === "postcode" ? before.toLowerCase() : before;
    const afterCmp = key === "email" || key === "postcode" ? after.toLowerCase() : after;
    if (beforeCmp === afterCmp) continue;
    changes.push(
      `• ${label}: "${before || "—"}" → "${after || "—"}"`
    );
  }
  const who = original.email || current.email || "deze klant";
  return [
    `Je hebt gegevens van een bestaande Moneybird-klant aangepast (${who}).`,
    "",
    "Als je doorgaat, worden deze gegevens in Moneybird gewijzigd voor die klant. Daarna wordt de factuur met de nieuwe gegevens aangemaakt.",
    "",
    ...(changes.length > 0 ? ["Gewijzigd:", ...changes, ""] : []),
    "Wil je doorgaan?",
  ].join("\n");
}

export function moneybirdContactDisplayName(contact: {
  company_name?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
}): string {
  const company = String(contact.company_name ?? "").trim();
  if (company) return company;
  const person = [contact.firstname, contact.lastname]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (person) return person;
  return String(contact.email ?? "").trim() || "Onbekende klant";
}

/** Splits Moneybird address1 ("Straat 12a") in straat + huisnummer voor het formulier. */
export function splitMoneybirdAddress1(address1: string | null | undefined): {
  straatnaam: string;
  huisnummer: string;
} {
  const raw = String(address1 ?? "").trim();
  if (!raw) return { straatnaam: "", huisnummer: "" };
  const m = raw.match(
    /^(.*?)[\s,]+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/
  );
  if (m) {
    return {
      straatnaam: m[1].trim(),
      huisnummer: m[2].replace(/\s+/g, "").trim(),
    };
  }
  return { straatnaam: raw, huisnummer: "" };
}
