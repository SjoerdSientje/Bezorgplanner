import { createServerSupabaseClient } from "@/lib/supabase";
import { splitVolledigAdres } from "@/lib/adres-fields";
import type { MoneybirdContactSuggestion } from "@/lib/moneybird-contact-shared";

type MpCustomerRow = {
  id: string;
  email: string | null;
  naam: string | null;
  telefoon_nummer: string | null;
  volledig_adres: string | null;
  afgerond_at: string | null;
};

/**
 * Unieke klanten uit afgeronde Marktplaats-orders (status mp_orders),
 * gefilterd op e-mailprefix/substring. Nieuwste order per e-mail wint.
 */
export async function searchMpOrderCustomersByEmailPrefix(
  ownerEmail: string,
  query: string,
  options?: { limit?: number }
): Promise<MoneybirdContactSuggestion[]> {
  const q = String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/[%_]/g, "");
  if (q.length < 2) return [];
  const limit = Math.min(20, Math.max(1, Math.floor(options?.limit ?? 10)));

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, email, naam, telefoon_nummer, volledig_adres, afgerond_at")
    .eq("owner_email", ownerEmail)
    .eq("source", "mp")
    .eq("status", "mp_orders")
    .not("email", "is", null)
    .ilike("email", `%${q}%`)
    .order("afgerond_at", { ascending: false, nullsFirst: false })
    .limit(80);

  if (error || !Array.isArray(data) || data.length === 0) return [];

  const prefixHits: MoneybirdContactSuggestion[] = [];
  const otherHits: MoneybirdContactSuggestion[] = [];
  const seenEmails = new Set<string>();

  for (const row of data as MpCustomerRow[]) {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);

    const adres = splitVolledigAdres(String(row.volledig_adres ?? ""));
    const naam = String(row.naam ?? "").trim();
    const suggestion: MoneybirdContactSuggestion = {
      id: `mp:${row.id}`,
      email,
      displayName: naam || email,
      firstname: "",
      lastname: "",
      companyName: naam,
      phone: String(row.telefoon_nummer ?? "").trim(),
      address1: [adres.straatnaam, adres.huisnummer].filter(Boolean).join(" "),
      zipcode: adres.postcode,
      city: adres.woonplaats,
      source: "mp",
    };

    if (email.startsWith(q)) prefixHits.push(suggestion);
    else if (email.includes(q)) otherHits.push(suggestion);
  }

  return [...prefixHits, ...otherHits].slice(0, limit);
}
