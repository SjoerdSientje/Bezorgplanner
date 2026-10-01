/** Gedeelde NL-adres helpers (zelfde formaat als MP-orders). */

export type AdresVelden = {
  straatnaam: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
};

export function formatPostcodeNl(raw: string | null | undefined): string {
  const p = String(raw ?? "")
    .replace(/\s/g, "")
    .toUpperCase();
  if (/^\d{4}[A-Z]{2}$/.test(p)) return `${p.slice(0, 4)} ${p.slice(4)}`;
  return String(raw ?? "").trim();
}

export function isCompletePostcodeNl(raw: string | null | undefined): boolean {
  return /^\d{4}[A-Z]{2}$/.test(String(raw ?? "").replace(/\s/g, "").toUpperCase());
}

/** Opslaan/tonen: "Straat, 12, 1234 AB, Amsterdam" (zelfde als MP normalizeAdres). */
export function formatVolledigAdres(parts: AdresVelden): string {
  return [parts.straatnaam, parts.huisnummer, parts.postcode, parts.woonplaats]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Parse volledig_adres terug naar velden.
 * Ondersteunt:
 * - 4 delen: "Straat, 12, 1234 AB, Amsterdam" (huidige opslag)
 * - 3 delen: "Straat 12, 1234 AB, Amsterdam"
 * - spatie-gescheiden legacy
 */
export function splitVolledigAdres(volledig: string): AdresVelden {
  const trimmed = String(volledig ?? "").trim();
  if (!trimmed) {
    return { straatnaam: "", huisnummer: "", postcode: "", woonplaats: "" };
  }

  const comma = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // 4+ delen, 3e is postcode: straat, huisnr, postcode, woonplaats...
  if (comma.length >= 4 && isCompletePostcodeNl(comma[2])) {
    return {
      straatnaam: comma[0] ?? "",
      huisnummer: comma[1] ?? "",
      postcode: formatPostcodeNl(comma[2]),
      woonplaats: comma.slice(3).join(", "),
    };
  }

  // 3+ delen, 2e is postcode: "straat huisnr, postcode, woonplaats"
  if (comma.length >= 3 && isCompletePostcodeNl(comma[1])) {
    const straatHuis = comma[0] ?? "";
    const sh = straatHuis.split(/\s+/).filter(Boolean);
    const huisnummer = sh.length > 1 ? (sh[sh.length - 1] ?? "") : "";
    const straatnaam = sh.length > 1 ? sh.slice(0, -1).join(" ") : straatHuis;
    return {
      straatnaam,
      huisnummer,
      postcode: formatPostcodeNl(comma[1]),
      woonplaats: comma.slice(2).join(", "),
    };
  }

  // Spatie-legacy: zoek postcode-token (evt. "1234" + "AB")
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const postcodeIdx = parts.findIndex(
    (p) =>
      isCompletePostcodeNl(p) ||
      /^\d{4}$/.test(p) ||
      /^\d{4}[A-Za-z]{2}$/i.test(p.replace(/,$/, ""))
  );
  if (postcodeIdx < 0) {
    return { straatnaam: trimmed, huisnummer: "", postcode: "", woonplaats: "" };
  }

  let postcode = parts[postcodeIdx]!.replace(/,$/, "");
  let woonplaatsStart = postcodeIdx + 1;
  if (
    /^\d{4}$/.test(postcode) &&
    parts[postcodeIdx + 1] &&
    /^[A-Za-z]{2},?$/i.test(parts[postcodeIdx + 1]!)
  ) {
    postcode = `${postcode} ${parts[postcodeIdx + 1]!.replace(/,$/, "").toUpperCase()}`;
    woonplaatsStart = postcodeIdx + 2;
  }

  const before = parts.slice(0, postcodeIdx).map((p) => p.replace(/,$/, ""));
  const huisnummer = before.length > 1 ? (before[before.length - 1] ?? "") : "";
  const straatnaam =
    before.length > 1 ? before.slice(0, -1).join(" ") : before.join(" ");
  const woonplaats = parts
    .slice(woonplaatsStart)
    .map((p) => p.replace(/,$/, ""))
    .join(" ");

  return {
    straatnaam,
    huisnummer,
    postcode: formatPostcodeNl(postcode),
    woonplaats,
  };
}
