import { createServerSupabaseClient } from "@/lib/supabase";
import { splitVolledigAdres } from "@/lib/adres-fields";
import { splitNaamToVoorAchternaam } from "@/lib/klanten-shared";
import type { MoneybirdContactSuggestion } from "@/lib/moneybird-contact-shared";

type MpCustomerRow = {
  id: string;
  email: string | null;
  naam: string | null;
  telefoon_nummer: string | null;
  volledig_adres: string | null;
  afgerond_at: string | null;
};

function rowToSuggestion(row: MpCustomerRow): MoneybirdContactSuggestion | null {
  const email = String(row.email ?? "").trim().toLowerCase();
  const naam = String(row.naam ?? "").trim();
  if (!email && !naam) return null;

  const adres = splitVolledigAdres(String(row.volledig_adres ?? ""));
  const { voornaam, achternaam } = splitNaamToVoorAchternaam(naam);
  return {
    id: `mp:${row.id}`,
    email,
    displayName: naam || email,
    firstname: voornaam,
    lastname: achternaam,
    companyName: naam,
    phone: String(row.telefoon_nummer ?? "").trim(),
    address1: [adres.straatnaam, adres.huisnummer].filter(Boolean).join(" "),
    zipcode: adres.postcode,
    city: adres.woonplaats,
    source: "mp",
  };
}

function suggestionMatchesQuery(
  suggestion: MoneybirdContactSuggestion,
  q: string
): "prefix" | "includes" | null {
  const email = suggestion.email;
  const first = suggestion.firstname.toLowerCase();
  const last = suggestion.lastname.toLowerCase();
  const display = suggestion.displayName.toLowerCase();
  const fullName = [first, last].filter(Boolean).join(" ");

  if (
    (email && email.startsWith(q)) ||
    first.startsWith(q) ||
    last.startsWith(q) ||
    display.startsWith(q) ||
    fullName.startsWith(q)
  ) {
    return "prefix";
  }
  if (
    (email && email.includes(q)) ||
    first.includes(q) ||
    last.includes(q) ||
    display.includes(q) ||
    fullName.includes(q)
  ) {
    return "includes";
  }
  return null;
}

/**
 * Unieke klanten uit afgeronde Marktplaats-orders (status mp_orders),
 * gefilterd op e-mail of naam. Nieuwste order per e-mail/naam wint.
 */
export async function searchMpOrderCustomersByEmailPrefix(
  ownerEmail: string,
  query: string,
  options?: { limit?: number }
): Promise<MoneybirdContactSuggestion[]> {
  const q = String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/[%_,]/g, "");
  if (q.length < 2) return [];
  const limit = Math.min(20, Math.max(1, Math.floor(options?.limit ?? 10)));

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, email, naam, telefoon_nummer, volledig_adres, afgerond_at")
    .eq("owner_email", ownerEmail)
    .eq("source", "mp")
    .eq("status", "mp_orders")
    .or(`email.ilike.%${q}%,naam.ilike.%${q}%`)
    .order("afgerond_at", { ascending: false, nullsFirst: false })
    .limit(80);

  if (error || !Array.isArray(data) || data.length === 0) return [];

  const prefixHits: MoneybirdContactSuggestion[] = [];
  const otherHits: MoneybirdContactSuggestion[] = [];
  const seenKeys = new Set<string>();

  for (const row of data as MpCustomerRow[]) {
    const suggestion = rowToSuggestion(row);
    if (!suggestion) continue;

    const key =
      suggestion.email ||
      `naam:${suggestion.displayName.toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const match = suggestionMatchesQuery(suggestion, q);
    if (match === "prefix") prefixHits.push(suggestion);
    else if (match === "includes") otherHits.push(suggestion);
  }

  return [...prefixHits, ...otherHits].slice(0, limit);
}
