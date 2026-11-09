/**
 * Gedeelde zoekmatching voor suggesties (Shopify, voorraad, incoming, enz.).
 *
 * Doelen:
 * - "gt2000" / "gt 2000" / "gt-2000" vinden hetzelfde
 * - "ouxi binnenband" vindt "Binnenband Ouxi" (woordvolgorde vrij)
 * - 1 typfout op langere woorden mag
 * - "gt2000" mag "gt20" níet raken (modelcode-grenzen)
 */

export function normalizeSearchText(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`´]/g, "");
}

/** Tokens op niet-alfanumerieke scheiding (spaties, streepjes, slashes, …). */
export function tokenizeSearchQuery(query: string): string[] {
  return normalizeSearchText(query)
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function compactSearchText(input: string): string {
  return normalizeSearchText(input).replace(/[^a-z0-9]+/g, "");
}

function isModelCodeToken(token: string): boolean {
  return /[a-z]/.test(token) && /\d/.test(token);
}

/** Damerau-Levenshtein (incl. aangrenzende omwisseling = 1 edit). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 1) return 99;

  const al = a.length;
  const bl = b.length;
  const d: number[][] = Array.from({ length: al + 1 }, () =>
    new Array<number>(bl + 1).fill(0)
  );
  for (let i = 0; i <= al; i++) d[i]![0] = i;
  for (let j = 0; j <= bl; j++) d[0]![j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[al]![bl]!;
}

/** Max 1 edit voor tokens ≥4; korter = geen fuzzy (te gevaarlijk). */
function fuzzyOk(queryToken: string, hayToken: string): boolean {
  if (queryToken.length < 4 || hayToken.length < 4) return false;
  if (Math.abs(queryToken.length - hayToken.length) > 1) return false;
  return editDistance(queryToken, hayToken) <= 1;
}

/** Alle aaneengesloten joins van tokens: gt + 2000 → gt2000. */
function adjacentJoins(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let acc = "";
    for (let j = i; j < tokens.length; j++) {
      acc += tokens[j];
      out.push(acc);
    }
  }
  return out;
}

function isLettersOnly(token: string): boolean {
  return /^[a-z]+$/.test(token);
}

function tokenMatches(queryToken: string, hayToken: string): boolean {
  if (!queryToken || !hayToken) return false;
  if (hayToken === queryToken) return true;

  if (isModelCodeToken(queryToken) || isModelCodeToken(hayToken)) {
    // Modelcodes: exact of 1 typfout — géén prefix/substring (voorkomt gt20 ⊂ gt2000).
    return fuzzyOk(queryToken, hayToken);
  }

  // Prefix: typ-as-you-go ("achte" → achtervering).
  if (hayToken.startsWith(queryToken)) return true;

  // Infix in letterwoorden vanaf 4 tekens ("vering" → achtervering).
  // Geen korte substrings: die geven te veel ruis.
  if (
    isLettersOnly(queryToken) &&
    isLettersOnly(hayToken) &&
    queryToken.length >= 4 &&
    hayToken.includes(queryToken)
  ) {
    return true;
  }

  return fuzzyOk(queryToken, hayToken);
}

function queryTokenCovered(
  queryToken: string,
  hayTokens: string[],
  hayJoins: string[]
): boolean {
  if (hayTokens.some((h) => tokenMatches(queryToken, h))) return true;

  // "gt2000" tegen hay ["gt","2000"] via join
  if (hayJoins.some((j) => j === queryToken || fuzzyOk(queryToken, j))) {
    return true;
  }

  // Compacte hay bevat modelcode alleen op token-grenzen (niet gt20 in gt2000).
  if (isModelCodeToken(queryToken)) {
    return hayJoins.includes(queryToken);
  }

  return false;
}

/**
 * Of `haystack` bij `query` hoort.
 * Lege query = alles; query zonder bruikbare tokens = false.
 */
export function matchesSearchQuery(haystack: string, query: string): boolean {
  const q = String(query ?? "").trim();
  if (!q) return true;

  const qTokens = tokenizeSearchQuery(q);
  if (qTokens.length === 0) return false;

  const hayNorm = normalizeSearchText(haystack);
  const hayTokens = tokenizeSearchQuery(hayNorm);
  if (hayTokens.length === 0) return false;

  const hayJoins = adjacentJoins(hayTokens);
  const qCompact = compactSearchText(q);
  const hayCompact = compactSearchText(hayNorm);

  // Hele query als één modelcode/compact (gt2000 ↔ gt-2000)
  if (qCompact.length >= 2 && (hayJoins.includes(qCompact) || hayCompact === qCompact)) {
    return true;
  }
  if (
    qCompact.length >= 4 &&
    isModelCodeToken(qCompact) &&
    hayJoins.some((j) => fuzzyOk(qCompact, j))
  ) {
    return true;
  }

  return qTokens.every((qt) => queryTokenCovered(qt, hayTokens, hayJoins));
}

/** Ranking: hogere score = beter. Geen match → -1. */
export function scoreSearchMatch(haystack: string, query: string): number {
  if (!matchesSearchQuery(haystack, query)) return -1;

  const qTokens = tokenizeSearchQuery(query);
  const hayNorm = normalizeSearchText(haystack);
  const hayTokens = tokenizeSearchQuery(hayNorm);
  const hayJoins = adjacentJoins(hayTokens);
  const qCompact = compactSearchText(query);
  const hayCompact = compactSearchText(hayNorm);

  let score = 0;
  if (hayCompact === qCompact) score += 500;
  else if (hayJoins.includes(qCompact)) score += 320;
  else if (hayCompact.startsWith(qCompact)) score += 180;

  for (const qt of qTokens) {
    const exactIdx = hayTokens.findIndex((h) => h === qt);
    if (exactIdx === 0) score += 90;
    else if (exactIdx > 0) score += 70;
    else if (hayTokens.some((h) => h.startsWith(qt) && !isModelCodeToken(qt))) score += 45;
    else if (
      isLettersOnly(qt) &&
      qt.length >= 4 &&
      hayTokens.some((h) => isLettersOnly(h) && h.includes(qt))
    )
      score += 35;
    else if (hayJoins.includes(qt)) score += 80;
    else score += 25; // fuzzy / join-fuzzy
  }

  score -= hayNorm.length / 200;
  return score;
}

/** Backwards-compatible alias. */
export function matchesAllSearchTokens(
  haystack: string,
  tokens: string[]
): boolean {
  if (tokens.length === 0) return false;
  return matchesSearchQuery(haystack, tokens.join(" "));
}
