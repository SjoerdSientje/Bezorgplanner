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
import { FACTUUR_BACKFILL_SINCE_ISO } from "@/lib/order-factuur";
import { createServerSupabaseClient } from "@/lib/supabase";

export type { Klant } from "@/lib/klanten-shared";
export {
  encodeKlantId,
  klantMatchesSearchPrefix,
  parseKlantId,
} from "@/lib/klanten-shared";

type OrderCustomerRow = {
  id: string;
  email: string | null;
  naam: string | null;
  telefoon_nummer: string | null;
  volledig_adres: string | null;
  afgerond_at: string | null;
};

function emptyBronnen(): Klant["bronnen"] {
  return { moneybird: false, mp: false, snelstart: false };
}

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
    bronnen: { ...emptyBronnen(), moneybird: true },
    moneybirdId: String(contact.id),
    mpOrderId: null,
    snelstartOrderId: null,
  };
}

function fromMpRow(row: OrderCustomerRow): Klant {
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
    bronnen: { ...emptyBronnen(), mp: true },
    moneybirdId: null,
    mpOrderId: row.id,
    snelstartOrderId: null,
  };
}

function fromSnelstartRow(row: OrderCustomerRow): Klant {
  const adres = splitVolledigAdres(String(row.volledig_adres ?? ""));
  const email = String(row.email ?? "").trim().toLowerCase();
  const naam = String(row.naam ?? "").trim();
  const { voornaam, achternaam } = splitNaamToVoorAchternaam(naam);
  return {
    id: encodeKlantId("ss", row.id),
    email,
    naam: naam || email || "Snelstart-klant",
    voornaam,
    achternaam,
    telefoon: String(row.telefoon_nummer ?? "").trim(),
    straatnaam: adres.straatnaam,
    huisnummer: adres.huisnummer,
    postcode: adres.postcode,
    woonplaats: adres.woonplaats,
    bronnen: { ...emptyBronnen(), snelstart: true },
    moneybirdId: null,
    mpOrderId: null,
    snelstartOrderId: row.id,
  };
}

/**
 * MB wint: Snelstart wordt samengevoegd tot Moneybird-klant (geen SS-badge meer).
 * MP-vlag blijft behouden.
 */
function mergePreferMoneybird(mb: Klant, other: Klant): Klant {
  return {
    ...mb,
    bronnen: {
      moneybird: true,
      mp: mb.bronnen.mp || other.bronnen.mp,
      snelstart: false,
    },
    mpOrderId: mb.mpOrderId || other.mpOrderId,
    snelstartOrderId: null,
    telefoon: mb.telefoon || other.telefoon,
    straatnaam: mb.straatnaam || other.straatnaam,
    huisnummer: mb.huisnummer || other.huisnummer,
    postcode: mb.postcode || other.postcode,
    woonplaats: mb.woonplaats || other.woonplaats,
    naam: mb.naam || other.naam,
    voornaam: mb.voornaam || other.voornaam,
    achternaam: mb.achternaam || other.achternaam,
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
): Promise<OrderCustomerRow[]> {
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

  if (q.length >= 1) {
    req = req.or(`email.ilike.${q}%,naam.ilike.${q}%,naam.ilike.% ${q}%`);
  }

  const { data, error } = await req;
  if (error || !Array.isArray(data)) return [];
  return data as OrderCustomerRow[];
}

/**
 * Afgeronde niet-MP orders vóór Moneybird (1 okt 2026).
 * Vult het gat voor klanten die toen via Snelstart liepen.
 */
async function listSnelstartCustomerRows(
  ownerEmail: string,
  options?: { query?: string; limit?: number }
): Promise<OrderCustomerRow[]> {
  const limit = Math.min(300, Math.max(1, Math.floor(options?.limit ?? 150)));
  const q = String(options?.query ?? "")
    .trim()
    .replace(/[%_]/g, "");

  const supabase = createServerSupabaseClient();
  let req = supabase
    .from("orders")
    .select("id, email, naam, telefoon_nummer, volledig_adres, afgerond_at")
    .eq("owner_email", ownerEmail)
    .eq("status", "bezorgd")
    .neq("source", "mp")
    .not("email", "is", null)
    .lt("afgerond_at", FACTUUR_BACKFILL_SINCE_ISO)
    .order("afgerond_at", { ascending: false, nullsFirst: false })
    .limit(limit * 2);

  if (q.length >= 1) {
    req = req.or(`email.ilike.${q}%,naam.ilike.${q}%,naam.ilike.% ${q}%`);
  }

  const { data, error } = await req;
  if (error || !Array.isArray(data)) return [];
  return data as OrderCustomerRow[];
}

function uniqueByEmail(
  rows: OrderCustomerRow[],
  mapRow: (row: OrderCustomerRow) => Klant
): Klant[] {
  const byEmail = new Map<string, Klant>();
  const withoutEmail: Klant[] = [];

  for (const row of rows) {
    const klant = mapRow(row);
    if (!klant.email) {
      withoutEmail.push(klant);
      continue;
    }
    if (!byEmail.has(klant.email)) byEmail.set(klant.email, klant);
  }

  return [...Array.from(byEmail.values()), ...withoutEmail];
}

/**
 * Klantenlijst = Moneybird + afgeronde MP + Snelstart (pre-1-okt niet-MP).
 * Bestaande MB-e-mail ⇒ geen aparte Snelstart-rij (samengevoegd als MB).
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

  const [mbList, mpRows, ssRows] = await Promise.all([
    includeMoneybird
      ? listMoneybirdContacts({
          query: q.length >= 1 ? q : undefined,
          page: 1,
          perPage: Math.min(100, limit),
        }).catch(() => [] as MoneybirdContact[])
      : Promise.resolve([] as MoneybirdContact[]),
    listMpCustomerRows(ownerEmail, { query: q, limit }),
    listSnelstartCustomerRows(ownerEmail, { query: q, limit }),
  ]);

  const mbKlanten = mbList.map(fromMoneybird);
  const mpKlanten = uniqueByEmail(mpRows, fromMpRow);
  const ssKlanten = uniqueByEmail(ssRows, fromSnelstartRow);

  const byEmail = new Map<string, Klant>();
  const noEmail: Klant[] = [];
  const mbEmails = new Set<string>();

  for (const k of mbKlanten) {
    if (!k.email) {
      noEmail.push(k);
      continue;
    }
    mbEmails.add(k.email);
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

  for (const k of ssKlanten) {
    if (!k.email) continue;
    // Bestaande MB-klant → niet als Snelstart tonen; wel merge (MB wint).
    if (mbEmails.has(k.email) || byEmail.get(k.email)?.bronnen.moneybird) {
      const existing = byEmail.get(k.email);
      if (existing?.bronnen.moneybird) {
        byEmail.set(k.email, mergePreferMoneybird(existing, k));
      }
      continue;
    }
    const existing = byEmail.get(k.email);
    if (!existing) {
      byEmail.set(k.email, k);
      continue;
    }
    // Alleen MP tot nu toe: combineer MP + Snelstart.
    byEmail.set(k.email, {
      ...existing,
      bronnen: {
        moneybird: false,
        mp: existing.bronnen.mp || k.bronnen.mp,
        snelstart: existing.bronnen.snelstart || k.bronnen.snelstart,
      },
      snelstartOrderId: existing.snelstartOrderId || k.snelstartOrderId,
      telefoon: existing.telefoon || k.telefoon,
      straatnaam: existing.straatnaam || k.straatnaam,
      huisnummer: existing.huisnummer || k.huisnummer,
      postcode: existing.postcode || k.postcode,
      woonplaats: existing.woonplaats || k.woonplaats,
      naam: existing.naam || k.naam,
      voornaam: existing.voornaam || k.voornaam,
      achternaam: existing.achternaam || k.achternaam,
    });
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
      const mpMatch = uniqueByEmail(mpRows, fromMpRow).find(
        (k) => k.email === klant.email
      );
      if (mpMatch) klant = mergePreferMoneybird(klant, mpMatch);
    }
    return klant;
  }

  if (parsed.kind === "ss") {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("orders")
      .select("id, email, naam, telefoon_nummer, volledig_adres, afgerond_at, source, status")
      .eq("owner_email", ownerEmail)
      .eq("id", parsed.rawId)
      .maybeSingle();

    if (error || !data) return null;
    let klant = fromSnelstartRow(data as OrderCustomerRow);

    // Intussen in MB aangemaakt → samengevoegd als Moneybird-klant.
    if (includeMoneybird && klant.email) {
      const mb = await findMoneybirdContactByEmail(klant.email);
      if (mb?.id) {
        return mergePreferMoneybird(fromMoneybird(mb), klant);
      }
    }

    if (klant.email) {
      const mpRows = await listMpCustomerRows(ownerEmail, {
        query: klant.email,
        limit: 20,
      });
      const mpMatch = uniqueByEmail(mpRows, fromMpRow).find(
        (k) => k.email === klant.email
      );
      if (mpMatch) {
        klant = {
          ...klant,
          bronnen: { ...klant.bronnen, mp: true },
          mpOrderId: mpMatch.mpOrderId,
        };
      }
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
  let klant = fromMpRow(data as OrderCustomerRow);

  if (includeMoneybird && klant.email) {
    const mb = await findMoneybirdContactByEmail(klant.email);
    if (mb?.id) {
      klant = mergePreferMoneybird(fromMoneybird(mb), klant);
    }
  }

  return klant;
}
