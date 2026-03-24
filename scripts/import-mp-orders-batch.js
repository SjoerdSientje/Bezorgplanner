/**
 * One-off: insert MP orders if not yet present (per owner_email + order_nummer).
 * Run: node scripts/import-mp-orders-batch.js
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
const raw = fs.readFileSync(envPath, "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const owners = ["info@koopjefatbike.nl", "malyar@aiventive.nl"];

function mapsUrl(adres) {
  const q = String(adres ?? "").trim();
  if (!q) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}`;
}

function normPhone(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return { e164: null, display: null };
  const compact = t.replace(/[\s().-]/g, "");
  if (compact.startsWith("+")) return { e164: compact, display: compact };
  if (compact.startsWith("00")) return { e164: "+" + compact.slice(2), display: t };
  if (compact.startsWith("06")) return { e164: "+31" + compact.slice(1), display: t };
  if (/^6\d{8}$/.test(compact)) return { e164: "+31" + compact, display: "0" + compact };
  if (compact.startsWith("31") && compact.length >= 11)
    return { e164: "+" + compact, display: t };
  if (/^\d{10,15}$/.test(compact)) return { e164: "+" + compact, display: t };
  return { e164: "+" + compact, display: t };
}

function parseBezorgdatum(s, year = 2026) {
  const str = String(s ?? "").trim();
  if (!str) return { date: null, afgerond_at: null };
  const m = str.match(/(\d{1,2})\.(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return { date: null, afgerond_at: null };
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  const date = `${year}-${mo}-${d}`;
  if (m[3] != null && m[4] != null) {
    const iso = `${year}-${mo}-${d}T${m[3].padStart(2, "0")}:${m[4]}:00.000Z`;
    return { date, afgerond_at: iso };
  }
  return { date, afgerond_at: `${date}T12:00:00.000Z` };
}

function parseBetaald(betaaldStr) {
  const b = String(betaaldStr ?? "").trim().toLowerCase();
  if (b === "betaald" || b.includes("contant")) return true;
  if (b === "pending") return false;
  return null;
}

const rows = [
  ["#3437", "Wesley Kapsenberg", "silas", "Contant aan de deur", 850, "03.03 16:42", "31 06 43127456", "V8 pro rijklaar + kettingslot", 849.0, "pending", "Van Leeuwenhoekstraat 118, , 2984 EJ, Ridderkerk", "Wesley.kapsenberg@gmail.com", 1, "31643127456", null],
  ["#3386", "Manou Lindaart", "Silas", "Contant aan de deur", 849, "03.03 20:15", "31 06 11175793", "V8 pro rijklaar + kettingslot", 849.0, "pending", "Doctor Vlamingstraat 4, , 2651 GK, Berkel en Rodenrijs", "manou010@outlook.com", 1, "31611175793", null],
  ["#MP1003", "Angela Vos", "Eef", "Contant aan de deur", 1550, "04.03 11:03", "31642168280", "V20 comfort rijklaar met alarm + V20 mini rijklaar met alarm + 2x kettingslot - 3x fatbike ophalen (zijn kapot, kosten overleggen)", 1565.0, "Contant aan deur", "Molenbeekstraat 41, 3521 ET, Utrecht", "janangela@live.nl", 5, "31642168280", null],
  ["#MP1006", "Janny Dassen", "Eef Doeleman", "Contant aan de deur", 800, "04.03 18:15", "31617114448", "V8 rijklaar + achterzitje gemonteerd + kettingslot ", 799.0, "Contant aan deur", "Sabangstraat 30, , 7541 ZD, Enschede", "janny-chelsey@live.nl", 1, "31617114448", null],
  ["#MP1008", "Janny Dassen", "Eef Doeleman", "Contant aan de deur", 800, "06.03 18:51", "31617114448", "V8 rijklaar + achterzitje gemonteerd + kettingslot", 799.0, "Contant aan deur", "Sabangstraat 30, 7541 ZD, Enschede", "ljanny-chelsey@live.nl", 1, "31617114448", null],
  ["#MP1009", "Mohamad Aminzadehmolan", "Eef Doeleman", "Contant aan de deur", 800, "09.03 16:18", "989350793667", "V20 pro zwart in doos + accu + oplader + display + kettingslot ", 799.0, "Contant aan deur", "Bosruiterweg 16, 3897 LV, Zeewolde", "amynzadhmhmd195@gmail.com", 1, "989350793667", null],
  ["#MP1011", "Kane van Rooij", "Eef Doeleman", "Contant aan de deur", 750, "09.03 17:19", "31610958054", "V8 zwart in doos + kettingslot ", 750.0, "Contant aan deur", "Morgenweg 25, 5406NJ, Uden", "kanevanrooij13@gmail.com", 1, "31610958054", null],
  ["#MP1012", "Katrien Rammelaere", "Eef Doeleman", "Contant aan de deur", 650, "10.03 17:53", "31618515020", "C80 mini roze rijklaar + kettingslot ", 649.0, "Contant aan deur", "Havenstraat 2, 9682PL, Oldambt", "rammelaere@hotmail.com", 1, "31618515020", null],
  ["#MPB1014", "Adil Tayan", "Eef Doeleman", "Contant aan de deur", 700, "11.03 13:52", "4915754941500", "V20 mini zwart rijklaar + kettingslot", 699.0, "Contant aan deur", "Bredenbachstraße 38, 46446, Emmerik", "adtyn@web.de", 1, "4915754941500", null],
  ["#MPB1016", "Ishamil Isaac Bangura", "silas", "Contant aan de deur", 750, "12.03 22:35", "23233920395", "V8 in doos + kettingslot ", 749.0, "Contant aan deur", "Vossemeerdijk 40, 8251 PN, Dronten", "isaacbangurap@gmail.com", 1, "23233920395", null],
  ["#MPB1017", "Asad al Omar", "Eef Doeleman", "Was al betaald", null, "14.03 13:10", "31616737335", "V20 rijklaar + kettingslot + telefoontasje ", 849.0, "Contant aan deur", "Wingerd 73, 2906 TB, Capelle aan den IJssel", "asadalomar83@gmail.com", 1, "31616737335", null],
  ["#MPA1001", "Mykhailo Volkerniuk", "Afgehaald in winkel", "Contant in de winkel", 800, "Afgehaald: 14.03 14:10", "31625190705", "V8 Ultra in Doos", 800, "Betaald", "Lakerveld 90, 4128 LK, Lexmond", "volkernyuk.mihail@gmail.com", 1, "31625190705", "https://docs.google.com/document/d/1tJhgkNYASeoh47wFdr_KWKBn5bnuHRAjVaVRF1ZbN78/edit?usp=drivesdk"],
  ["#MPA1002", "Van den Brink", "Afgehaald in winkel", "Contant in de winkel", 1400, "Afgehaald: 14.03 14:46", "31653515037", "V20 mini Grijs rijklaar + V10 zwart rijklaar", 1400, "Betaald", "kamphofstraat 2, 4012 BM, Kerk-avezaath", "andre1977@msn.com", 2, "31653515037", "https://docs.google.com/document/d/17rBzkqtu_PTlZ4ngpzJb637DoenXIvB3K57JyeuD0KA/edit?usp=drivesdk"],
  ["#MPA1003", "van Loenhout", "Afgehaald in winkel", "Contant in de winkel", 650, "Afgehaald: 14.03 17:15", "31621913002", "Ultra mini", 650, "Betaald", "Hoogeind 6, 2940, Stabroek", "petertje1964@icloud.com", 1, "31621913002", "https://docs.google.com/document/d/1CE4bSIw4t4cuMlYB5Jqai8vviJbvpsA6LyAtTsqrabU/edit?usp=drivesdk"],
  ["#MPA1004", "Dominik Sowala", "Afgehaald in winkel", "Contant in de winkel", 600, "Afgehaald: 14.03 17:46", "48570088881", "C80 Mini in box", 600, "Betaald", "oosterhoutsestraat 2, 6677PS, Slijk-Ewijk", "dominiksowala@interia.pl", 1, "48570088881", "https://docs.google.com/document/d/18jkxMIjtKNM7S00VuZZJPDxjip6vaSnfibP6apuK9fw/edit?usp=drivesdk"],
  ["#MPA1005", "Michael Perk", "Afgehaald in winkel", "Contant in de winkel", 920, "Afgehaald: 14.03 17:54", "31683700183", "V8 ", 920, "Betaald", "Koningin Julianalaan 13, 1421AH, Uithoorn", "mperk70@outlook.com", 1, "31683700183", "https://docs.google.com/document/d/1n_YRpzhmvtSRcv6eHE0ZwLBmKK8YdwVlgZQS83shKHQ/edit?usp=drivesdk"],
  ["#MPB1018", "Olena Pavlyshena", "silas", "Contant aan de deur", 850, "16.03 11:13", "31625190705", "V8 Ultra in Doos", 850.0, "Contant aan deur", "Lakerveld 90, 4128 LK, Lexmond", "volkernyuk.mihail@gmail.com", 1, "31625190705", null],
  ["#MPA1006", "Leenders", "Afgehaald in winkel", "Contant in de winkel", 690, "Afgehaald: 17.03 12:04", "491735279248", "C80 Mini in doos", 690, "Betaald", "Hauptstrasse 6, 47559, Kranenburg", "leendersf@aol.com", 1, "491735279248", "https://docs.google.com/document/d/1_obHkx5eJHmLwIldZVZiCq8MPbnKkkUWQS9ZgKqW2ZQ/edit?usp=drivesdk"],
  ["#MPB1015", "Sen Den Herder", "silas", "Contant aan de deur", 900, "17.03 16:05", "31631311360", "V8 ultra rijklaar bruin zadel + kettingslot ", 899.0, "Contant aan deur", "Beatrixlaan 15, , 3851 RT, Ermelo", "twenkel@live.nl", 1, "31631311360", null],
  ["#MPB1020", "Deborah Jacobs", "Eef Doeleman", "Contant aan de deur", 800, "19.03 12:05", "31651770112", "OUXI V10 city bike + kettingslot + voorrekje gemonteerd ", 800.0, "Contant aan deur", "manilius 8, 3962SB, Wijk bij duurstede", "D.jacobs-janssen@outlook.com", 1, "31651770112", null],
  ["#MPB1023", "Melariek Senchi", "Eef Doeleman", "Contant aan de deur", 850, "20.03 12:57", "31648883846", "V20 pro rijklaar + kettingslot ", 849.0, "Contant aan deur", "Reviusrondeel 17, 2902 EA, Capelle aan den IJssel", "msenchi@hotmail.com", 1, "31648883846", null],
  ["#MPB1022", "Marianne Janssen", "Eef Doeleman", "Contant aan de deur", 800, "20.03 14:44", "31621845722", "OUXI V10 zwart rijklaar + telefoonhouder aan het stuur + spiegel + 2x telefoontasje + kettingslot ", 800.0, "Contant aan deur", "Moerbijengaard 22, 3962JE, Wijk bij duurstede", "D.jacobs-janssen@outlook.com", 1, "31621845722", null],
  ["#MPB1025", "Melanie Zonnenberg", "Eef Doeleman", "Contant aan de deur", 700, "21.03 14:26", "31636265020", "V20 mini paars rijklaar + kettingslot ", 699.0, "Contant aan deur", "Hoekstraat 15, 7545 WX, Enschede", "melaniezonnenberg@live.nl", 1, "31636265020", null],
  ["#MPB1026", "Leon van Eeuwijk", "silas", "Contant aan de deur", 850, "23.03 10:58", "31646610532", "V20 pro rijklaar + kettingslot + alarm", 849.0, "Contant aan deur", "Edelmanstraat 3, 5331TG, Kerkdriel", "wendyleonvaneeuwijk@hotmail.com", 1, "31646610532", null],
  ["#MPB1027", "Netten", "silas", "Contant aan de deur", 800, "23.03 11:57", "31643907332", "H9 rijklaar + achterzitje gemonteerd + voorrekje gemonteerd + kettingslot", 800.0, "Contant aan deur", "Beembreek 2, 5091 EH, Middelbeers", "priscillaenjos@live.nl", 1, "31643907332", null],
  ["#MPB1028", "Gert Battenberg", "silas", "Contant aan de deur", 750, "23.03 17:11", "31628441638", "V8 in doos + kettingslot ", 750.0, "Contant aan deur", "Pieter a. Van heijningestraat 9, 1035 SV, Amsterdam", "gert@battenberg.nl", 1, "31628441638", null],
];

function rowToPayload(r) {
  const [
    order_nummer,
    naam,
    bezorger,
    betaalmethodeRaw,
    betaald_bedrag,
    bezorgdatumRaw,
    telefoon_raw,
    producten,
    totaal_prijs,
    betaald_kolom,
    adres,
    email,
    aantal_fietsen,
    e164_raw,
    link_aankoop,
  ] = r;

  const betaalmethode = String(betaalmethodeRaw ?? "").trim() || null;
  const { date: datumParsed, afgerond_at: parsedAt } = parseBezorgdatum(bezorgdatumRaw);
  const phoneFromE164 = normPhone(e164_raw);
  const phoneFromRaw = normPhone(telefoon_raw);
  const telefoon_e164 = phoneFromE164.e164 || phoneFromRaw.e164;
  const telefoon_nummer = phoneFromRaw.display || phoneFromE164.display || telefoon_e164;

  const betaald = parseBetaald(betaald_kolom);
  const orderUpper = String(order_nummer).toUpperCase();
  const type = orderUpper.includes("MPA") ? "mp_winkel" : "verkoop";

  const bel = telefoon_e164 ? `https://call.ctrlq.org/${telefoon_e164}` : null;

  return {
    source: "mp",
    type,
    status: "mp_orders",
    order_nummer: String(order_nummer).trim(),
    naam: String(naam).trim(),
    adres_url: mapsUrl(adres),
    bel_link: bel,
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: null,
    meenemen_in_planning: false,
    nieuw_appje_sturen: false,
    datum_opmerking: null,
    opmerkingen_klant: null,
    producten: String(producten).trim(),
    bestelling_totaal_prijs: Number(totaal_prijs),
    betaald,
    betaalmethode,
    betaald_bedrag:
      betaald_bedrag != null && betaald_bedrag !== ""
        ? Number(betaald_bedrag)
        : null,
    volledig_adres: String(adres).trim() || null,
    telefoon_nummer: telefoon_nummer || null,
    telefoon_e164: telefoon_e164 || null,
    order_id: null,
    datum: datumParsed,
    aantal_fietsen: Number(aantal_fietsen) || null,
    email: String(email).trim() || null,
    model: null,
    serienummer: null,
    mp_tags: "MP",
    link_aankoopbewijs: link_aankoop ? String(link_aankoop).trim() : null,
    bezorger_naam: String(bezorger).trim() || null,
    afgerond_at: parsedAt || new Date().toISOString(),
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const summary = { inserted: [], skipped: [], errors: [] };

  for (const r of rows) {
    const order_nummer = String(r[0]).trim();
    const payloadBase = rowToPayload(r);

    for (const owner_email of owners) {
      const { data: existing } = await supabase
        .from("orders")
        .select("id")
        .eq("owner_email", owner_email)
        .eq("order_nummer", order_nummer)
        .maybeSingle();

      if (existing?.id) {
        summary.skipped.push({ order_nummer, owner_email, id: existing.id });
        continue;
      }

      const row = { ...payloadBase, owner_email };
      const { data, error } = await supabase
        .from("orders")
        .insert(row)
        .select("id, owner_email, order_nummer")
        .single();

      if (error) {
        summary.errors.push({ order_nummer, owner_email, error: error.message });
        continue;
      }
      summary.inserted.push(data);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) process.exitCode = 1;
}

main();
