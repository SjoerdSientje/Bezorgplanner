import { splitMoneybirdAddress1 } from "@/lib/moneybird-contact-shared";
import { splitVolledigAdres } from "@/lib/adres-fields";
import {
  encodeKlantId,
  klantMatchesSearchPrefix,
  parseKlantId,
  splitNaamToVoorAchternaam,
  type Klant,
} from "@/lib/klanten-shared";
import {
  findMoneybirdContactByEmail,
  getMoneybirdContactById,
  listMoneybirdContacts,
  moneybirdContactDisplayName,
  type MoneybirdContact,
} from "@/lib/moneybird";
import { createServerSupabaseClient } from "@/lib/supabase";

export type { Klant } from "@/lib/klanten-shared";
export {
  encodeKlantId,
  klantMatchesSearchPrefix,
  parseKlantId,
} from "@/lib/klanten-shared";

type MpCustomerRow = {
  id: string;
  email: string | null;
  naam: string | null;
  telefoon_nummer: string | null;
  volledig_adres: string | null;
  afgerond_at: string | null;
};

function fromMoneybird(contact: MoneybirdContact): Klant {
  const { straatnaam, huisnummer } = splitMoneybirdAddress1(contact.address1);
  const email = String(contact.email ?? "").trim().toLowerCase();
  const voornaam = String(contact.firstname ?? "").trim();
  const achternaam = String(contact.lastname ?? "").trim();
  return {
    id: encodeKlantId("mb", String(contact.id)),
    email,
    naam: moneybirdContactDisplayName(contact),
    voornaam,
    achternaam,
    telefoon: String(contact.phone ?? "").trim(),
    straatnaam,
    huisnummer,
    postcode: String(contact.zipcode ?? "").trim(),
    woonplaats: String(contact.city ?? "").trim(),
    bronnen: { moneybird: true, mp: false },
    moneybirdId: String(contact.id),
    mpOrderId: null,
  };
}

function fromMpRow(row: MpCustomerRow): Klant {
  const adres = splitVolledigAdres(String(row.volledig_adres ?? ""));
  const email = String(row.email ?? "").trim().toLowerCase();
  const naam = String(row.naam ?? "").trim();
  const { voornaam, achternaam } = splitNaamToVoorAchternaam(naam);
  return {
    id: encodeKlantId("mp", row.id),
    email,
    naam: naam || email || "MP-klant",
    voornaam,
    achternaam,
    telefoon: String(row.telefoon_nummer ?? "").trim(),
    straatnaam: adres.straatnaam,
    huisnummer: adres.huisnummer,
    postcode: adres.postcode,
    woonplaats: adres.woonplaats,
    bronnen: { moneybird: false, mp: true },
    moneybirdId: null,
    mpOrderId: row.id,
  };
}

/** MB wint voor gegevens; MP-vlag blijft staan. */
function mergePreferMoneybird(mb: Klant, mp: Klant): Klant {
  return {
    ...mb,
    bronnen: { moneybird: true, mp: true },
    mpOrderId: mp.mpOrderId,
    telefoon: mb.telefoon || mp.telefoon,
    straatnaam: mb.straatnaam || mp.straatnaam,
    huisnummer: mb.huisnummer || mp.huisnummer,
    postcode: mb.postcode || mp.postcode,
    woonplaats: mb.woonplaats || mp.woonplaats,
    naam: mb.naam || mp.naam,
    voornaam: mb.voornaam || mp.voornaam,
    achternaam: mb.achternaam || mp.achternaam,
  };
}

function sortKlanten(list: Klant[]): Klant[] {
  return [...list].sort((a, b) => {
    const an = a.naam.toLowerCase() || a.email;
    const bn = b.naam.toLowerCase() || b.email;
    return an.localeCompare(bn, "nl");
  });
}

async function listMpCustomerRows(
  ownerEmail: string,
  options?: { query?: string; limit?: number }
): Promise<MpCustomerRow[]> {
  const limit = Math.min(300, Math.max(1, Math.floor(options?.limit ?? 150)));
  const q = String(options?.query ?? "")
    .trim()
    .replace(/[%_]/g, "");

  const supabase = createServerSupabaseClient();
  let req = supabase
    .from("orders")
    .select("id, email, naam, telefoon_nummer, volledig_adres, afgerond_at")
    .eq("owner_email", ownerEmail)
    .eq("source", "mp")
    .eq("status", "mp_orders")
    .order("afgerond_at", { ascending: false, nullsFirst: false })
    .limit(limit * 2);

  // Brede kandidaten (prefix e-mail/naam of achternaam ergens in naam); strikte filter daarna.
  if (q.length >= 1) {
    req = req.or(`email.ilike.${q}%,naam.ilike.${q}%,naam.ilike.% ${q}%`);
  }

  const { data, error } = await req;
  if (error || !Array.isArray(data)) return [];
  return data as MpCustomerRow[];
}

function uniqueMpKlanten(rows: MpCustomerRow[]): Klant[] {
  const byEmail = new Map<string, Klant>();
  const withoutEmail: Klant[] = [];

  for (const row of rows) {
    const klant = fromMpRow(row);
    if (!klant.email) {
      withoutEmail.push(klant);
      continue;
    }
    if (!byEmail.has(klant.email)) byEmail.set(klant.email, klant);
  }

  return [...Array.from(byEmail.values()), ...withoutEmail];
}

/**
 * Gecombineerde klantenlijst: Moneybird + afgeronde MP-orders.
 * Zoeken: alleen voornaam / achternaam / e-mail die begint met de query.
 */
export async function searchKlanten(
  ownerEmail: string,
  options?: {
    query?: string;
    includeMoneybird?: boolean;
    limit?: number;
  }
): Promise<Klant[]> {
  const q = String(options?.query ?? "").trim();
  const includeMoneybird = options?.includeMoneybird !== false;
  const limit = Math.min(200, Math.max(1, Math.floor(options?.limit ?? 100)));

  const [mbList, mpRows] = await Promise.all([
    includeMoneybird
      ? listMoneybirdContacts({
          query: q.length >= 1 ? q : undefined,
          page: 1,
          perPage: Math.min(100, limit),
        }).catch(() => [] as MoneybirdContact[])
      : Promise.resolve([] as MoneybirdContact[]),
    listMpCustomerRows(ownerEmail, { query: q, limit }),
  ]);

  const mbKlanten = mbList.map(fromMoneybird);
  const mpKlanten = uniqueMpKlanten(mpRows);

  const byEmail = new Map<string, Klant>();
  const noEmail: Klant[] = [];

  for (const k of mbKlanten) {
    if (!k.email) {
      noEmail.push(k);
      continue;
    }
    byEmail.set(k.email, k);
  }

  for (const k of mpKlanten) {
    if (!k.email) {
      noEmail.push(k);
      continue;
    }
    const existing = byEmail.get(k.email);
    if (existing?.bronnen.moneybird) {
      byEmail.set(k.email, mergePreferMoneybird(existing, k));
    } else if (!existing) {
      byEmail.set(k.email, k);
    }
  }

  let merged = sortKlanten([...Array.from(byEmail.values()), ...noEmail]);

  if (q.length >= 1) {
    merged = merged.filter((k) => klantMatchesSearchPrefix(k, q));
  }

  return merged.slice(0, limit);
}

export async function getKlantById(
  ownerEmail: string,
  id: string,
  options?: { includeMoneybird?: boolean }
): Promise<Klant | null> {
  const parsed = parseKlantId(id);
  if (!parsed) return null;
  const includeMoneybird = options?.includeMoneybird !== false;

  if (parsed.kind === "mb") {
    if (!includeMoneybird) return null;
    const contact = await getMoneybirdContactById(parsed.rawId);
    if (!contact?.id) return null;
    let klant = fromMoneybird(contact);
    if (klant.email) {
      const mpRows = await listMpCustomerRows(ownerEmail, {
        query: klant.email,
        limit: 20,
      });
      const mpMatch = uniqueMpKlanten(mpRows).find(
        (k) => k.email === klant.email
      );
      if (mpMatch) klant = mergePreferMoneybird(klant, mpMatch);
    }
    return klant;
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, email, naam, telefoon_nummer, volledig_adres, afgerond_at")
    .eq("owner_email", ownerEmail)
    .eq("source", "mp")
    .eq("id", parsed.rawId)
    .maybeSingle();

  if (error || !data) return null;
  let klant = fromMpRow(data as MpCustomerRow);

  if (includeMoneybird && klant.email) {
    const mb = await findMoneybirdContactByEmail(klant.email);
    if (mb?.id) {
      klant = mergePreferMoneybird(fromMoneybird(mb), klant);
    }
  }

  return klant;
}
