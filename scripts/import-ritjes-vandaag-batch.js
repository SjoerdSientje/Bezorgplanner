/**
 * Insert orders into Ritjes voor vandaag (status ritjes_vandaag) if not present
 * per owner_email + order_nummer. Run: node scripts/import-ritjes-vandaag-batch.js
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
  if (q.startsWith("http://") || q.startsWith("https://")) return q;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}`;
}

function normPhone(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return { e164: null };
  const compact = t.replace(/[\s().-]/g, "");
  if (compact.startsWith("+")) return { e164: compact };
  if (compact.startsWith("00")) return { e164: "+" + compact.slice(2) };
  if (compact.startsWith("06")) return { e164: "+31" + compact.slice(1) };
  if (/^6\d{8}$/.test(compact)) return { e164: "+31" + compact };
  if (compact.startsWith("31") && compact.length >= 11) return { e164: "+" + compact };
  if (/^\d{10,15}$/.test(compact)) return { e164: "+" + compact };
  return { e164: "+" + compact };
}

function belLink(e164) {
  const p = normPhone(e164);
  if (!p.e164) return null;
  return `https://call.ctrlq.org/${p.e164}`;
}

function parseJaNee(s) {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "ja") return true;
  if (v === "nee") return false;
  return null;
}

/** betaald column + shopify hint */
function parseBetaaldCol(s) {
  const t = String(s ?? "").trim().toLowerCase();
  if (!t) return { betaald: null, betaalmethode: null };
  if (t === "betaald" || t === "paid") return { betaald: true, betaalmethode: null };
  if (t === "pending") return { betaald: false, betaalmethode: null };
  if (t.includes("factuur")) return { betaald: false, betaalmethode: "Factuur betaling aan deur" };
  if (t.includes("contant")) return { betaald: true, betaalmethode: "Contant aan deur" };
  return { betaald: null, betaalmethode: t || null };
}

function parseDatum(isoOrDate) {
  const s = String(isoOrDate ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isMpOrderNum(num) {
  return /^#MP/i.test(String(num).trim());
}

/**
 * Each row: {
 *   order_nummer, naam, adres_url_raw, bel_raw, aankomsttijd_slot, bezorgtijd_voorkeur,
 *   meenemen, nieuw_appje, datum_opmerking, opmerkingen_klant, producten, totaal_prijs,
 *   betaald_col, volledig_adres, telefoon_raw, order_id_shopify, datum_iso, aantal_fietsen,
 *   email, e164_raw, mp_tags_raw, shopify_paid_hint, model, serienummer
 * }
 */
const rows = [
  {
    order_nummer: "#2082",
    naam: "Ronny de Pruijssenaere",
    adres_url_raw: "Professor Beelhoek 73, , 4908 CW, Oosterhout",
    bel_raw: "31654368874",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "Bezorgen als we hem binnen hebben",
    opmerkingen_klant: null,
    producten: null,
    totaal_prijs: null,
    betaald_col: null,
    volledig_adres: "Professor Beelhoek 73, , 4908 CW, Oosterhout",
    telefoon_raw: "31654368874",
    order_id_shopify: null,
    datum_iso: null,
    aantal_fietsen: null,
    email: null,
    e164_raw: "31654368874",
    mp_tags_raw: null,
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3569",
    naam: "Anais Narcisio",
    adres_url_raw: "https://maps.google.com/maps?q=Nieuwkerksplein, , 3311 TJ, Dordrecht",
    bel_raw: "Bel Anais",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "Wachten op reactie, Telnr klopt niet",
    opmerkingen_klant: null,
    producten: "OUXI V8 / C80 6.0 Fatbike 2025 Mat-zwart | Combi-Deal 🔥",
    totaal_prijs: 899.0,
    betaald_col: "factuur betaling aan deur",
    volledig_adres: "Nieuwkerksplein, , 3311 TJ, Dordrecht",
    telefoon_raw: "31687320437",
    order_id_shopify: "8065259766027",
    datum_iso: "2026-03-16T16:01:51+01:00",
    aantal_fietsen: 1,
    email: "argien756@gmail.com",
    e164_raw: "31687320437",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#MPB1019",
    naam: "Parker",
    adres_url_raw: "https://maps.google.com/maps?q=Wittewerf 36, 1357AC, Almere",
    bel_raw: "Bel Parker",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "Wachten op goedkeuring",
    opmerkingen_klant: "geen opmerking",
    producten:
      "In doos: 1x V20 mini grijs, 1x V8 ultra mini roze, 1x C80 mini lichtblauw, 2x C80 mini zwart",
    totaal_prijs: 2800.0,
    betaald_col: "Contant aan deur",
    volledig_adres: "Wittewerf 36, 1357AC, Almere",
    telefoon_raw: "31627597726",
    order_id_shopify: null,
    datum_iso: "2026-03-16T16:03:04.227Z",
    aantal_fietsen: 5,
    email: "parkercindy70@gmail.com",
    e164_raw: "31627597726",
    mp_tags_raw: "MP",
    model: "V20 MINI, V8 ULTRA MINI, C80 MINI, C80 MINI",
    serienummer: null,
  },
  {
    order_nummer: "#MPB1021",
    naam: "S. Van Eck",
    adres_url_raw: "https://maps.google.com/maps?q=Vlierboomstraat 22, 2404 EE, Alphen aan den Rijn",
    bel_raw: "Bel S. Van Eck",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "Datum: 27.3",
    opmerkingen_klant: "geen opmerking",
    producten: "V20 pro rijklaar + kettingslot ",
    totaal_prijs: 849.0,
    betaald_col: "Contant aan deur",
    volledig_adres: "Vlierboomstraat 22, 2404 EE, Alphen aan den Rijn",
    telefoon_raw: "31624460995",
    order_id_shopify: null,
    datum_iso: "2026-03-19T08:55:54.560Z",
    aantal_fietsen: 1,
    email: "sw.v.eck@gmail.com",
    e164_raw: "31624460995",
    mp_tags_raw: "MP",
    model: "V20 PRO",
    serienummer: null,
  },
  {
    order_nummer: "#MPB1024",
    naam: "Justin",
    adres_url_raw: "https://maps.google.com/maps?q=Krommemijdrechtstraat 22, 1972 VR, Ijmuiden",
    bel_raw: "Bel Justin",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "Datum: 28.4",
    opmerkingen_klant: "geen opmerking",
    producten: "V20 rijklaar + kettingslot ",
    totaal_prijs: 849.0,
    betaald_col: "Contant aan deur",
    volledig_adres: "Krommemijdrechtstraat 22, 1972 VR, Ijmuiden",
    telefoon_raw: "31681352797",
    order_id_shopify: null,
    datum_iso: "2026-03-20T12:05:22.360Z",
    aantal_fietsen: 1,
    email: "j.meirmans.jn@gmail.com",
    e164_raw: "31681352797",
    mp_tags_raw: "MP",
    model: "V20",
    serienummer: null,
  },
  {
    order_nummer: "#3614",
    naam: "Olivier van 't Hof",
    adres_url_raw: "https://maps.google.com/maps?q=Amersfoortsestraatweg 31, , 1401 CV, Bussum",
    bel_raw: "Bel Olivier",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "ja",
    nieuw_appje: "ja",
    datum_opmerking: "Bezorgen als we hem binnen hebben",
    opmerkingen_klant: null,
    producten:
      "ADO Air 20 Pro | Ultra - Blauw - high-tech vouw- e-bike - 3-speed Ultra Hooglans Blauw (+ € 300)",
    totaal_prijs: 1899.0,
    betaald_col: "betaald",
    volledig_adres: "Amersfoortsestraatweg 31, , 1401 CV, Bussum",
    telefoon_raw: "624207925",
    order_id_shopify: "8076783419659",
    datum_iso: "2026-03-21T09:53:36+01:00",
    aantal_fietsen: 1,
    email: "oliviervanthof@gmail.com",
    e164_raw: "31624207925",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3618",
    naam: "Jan van Eijk",
    adres_url_raw: "https://maps.google.com/maps?q=De Kapberg 9, , 3471 DC, Kamerik",
    bel_raw: "Bel Jan",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "Bezorgen als we hem binnen hebben",
    opmerkingen_klant: "geen opmerking",
    producten: "V20 pro nardo grey rijklaar + kettingslot + achterzitje apart + voorrekje apart ",
    totaal_prijs: 999.0,
    betaald_col: "factuur betaling aan deur",
    volledig_adres: "De Kapberg 9, , 3471 DC, Kamerik",
    telefoon_raw: "31629289585",
    order_id_shopify: "8077258883339",
    datum_iso: "2026-03-21T13:20:44+01:00",
    aantal_fietsen: 1,
    email: "vaneijk01@gmail.com",
    e164_raw: "31629289585",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3621",
    naam: "Marijke de Hart",
    adres_url_raw: "https://maps.google.com/maps?q=Birkastraat 83, , 3962 BP, Wijk bij Duurstede",
    bel_raw: "Bel Marijke",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "Datum: 28.3",
    opmerkingen_klant: "geen opmerking",
    producten:
      "V20 pro rijklaar + locater + verzekering + voorrekje gemonteerd + fietskrat gemonteerd + kettingslot",
    totaal_prijs: 1148.9,
    betaald_col: "betaald",
    volledig_adres: "Birkastraat 83, , 3962 BP, Wijk bij Duurstede",
    telefoon_raw: "31627887221",
    order_id_shopify: "8077469614347",
    datum_iso: "2026-03-21T14:53:06+01:00",
    aantal_fietsen: 1,
    email: "marijke_dehart@msn.com",
    e164_raw: "31627887221",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3622",
    naam: "Deborah Parent",
    adres_url_raw: "https://maps.google.com/maps?q=Van Coehoornstraat 27, , 4143 BK, Leerdam",
    bel_raw: "Bel Deborah",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "ja",
    nieuw_appje: "ja",
    datum_opmerking: "vandaag",
    opmerkingen_klant: "ADO op de factuur zetten - apart een garantiebewijs maken",
    producten:
      "V20 pro rijklaar zwart + kettingslot & V20 mini grijs rijklaar + kettingslot (fisc free)",
    totaal_prijs: 1999.0,
    betaald_col: "factuur betaling aan deur",
    volledig_adres: "Van Coehoornstraat 27, , 4143 BK, Leerdam",
    telefoon_raw: "31623600177",
    order_id_shopify: "8077618053387",
    datum_iso: "2026-03-21T15:57:32+01:00",
    aantal_fietsen: 1,
    email: "miss_deo@hotmail.com",
    e164_raw: "31623600177",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3638",
    naam: "Ashley de Rijk",
    adres_url_raw: "https://maps.google.com/maps?q=Sonckstraat 21, , 1623 JH, Hoorn",
    bel_raw: "Bel Ashley",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "Tijd: tussen 13.00 - 17.00",
    meenemen: "ja",
    nieuw_appje: "ja",
    datum_opmerking: "vandaag",
    opmerkingen_klant: null,
    producten:
      "Tracker GPS - Tag Apple iPhone smart+Voorrekje voor Fatbikes+Volledig rijklaar+OUXI V8 / C80 6.0 Fatbike 2025 Mat-zwart | Combi-Deal 🔥 + achterzitje gemonteerd ‼️",
    totaal_prijs: 945.9,
    betaald_col: "factuur betaling aan deur",
    volledig_adres: "Sonckstraat 21, , 1623 JH, Hoorn",
    telefoon_raw: "648513390",
    order_id_shopify: "8084104151307",
    datum_iso: "2026-03-24T11:22:17+01:00",
    aantal_fietsen: 1,
    email: "info@feminine-essentials.nl",
    e164_raw: "31648513390",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3639",
    naam: "Scarlet Raap",
    adres_url_raw: "https://maps.google.com/maps?q=Reigersbek 22, , 3434 XJ, Nieuwegein",
    bel_raw: "Bel Scarlet",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "Tijd: na 14:30",
    meenemen: "ja",
    nieuw_appje: "ja",
    datum_opmerking: "vandaag",
    opmerkingen_klant: "geen opmerking",
    producten:
      "Reparatie aan huis: V8 toeter blijft hangen, waarschijnlijk lichtschakelaar vervangen. (Ook koplamp meenemen) | Garantie + 40,- voorrijkosten",
    totaal_prijs: 40.0,
    betaald_col: "factuur betaling aan deur",
    volledig_adres: "Reigersbek 22, , 3434 XJ, Nieuwegein",
    telefoon_raw: "31645296867",
    order_id_shopify: "8084145504523",
    datum_iso: "2026-03-24T11:41:31+01:00",
    aantal_fietsen: null,
    email: "raap.hassell@gmail.com",
    e164_raw: "31645296867",
    mp_tags_raw: "geen tag",
    model: "Reparatie aan huis",
    serienummer: null,
  },
  {
    order_nummer: "#3640",
    naam: "Karin Verbeet",
    adres_url_raw: "https://maps.google.com/maps?q=Zittertstraat 13, , 5361 AC, Grave",
    bel_raw: "Bel Karin",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "Tijd: na 11:00",
    meenemen: "ja",
    nieuw_appje: "ja",
    datum_opmerking: "vandaag",
    opmerkingen_klant:
      "Graag aub woensdag 24 maart 2026 na 11 uur leveren ..",
    producten:
      "Volledig rijklaar+OUXI Q8 Fatbike 2026 | Lage instap | Combi-Deal 🔥 + voorrekje gemonteerd",
    totaal_prijs: 1149.0,
    betaald_col: "betaald",
    volledig_adres: "Zittertstraat 13, , 5361 AC, Grave",
    telefoon_raw: "620490909",
    order_id_shopify: "8084152221963",
    datum_iso: "2026-03-24T11:44:25+01:00",
    aantal_fietsen: 1,
    email: "karin.verbeet@kpnmail.nl",
    e164_raw: "31620490909",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3642",
    naam: "Dzemil Numanovic",
    adres_url_raw: "https://maps.google.com/maps?q=Marterrade 285, , 2544 MK, 's-Gravenhage",
    bel_raw: "Bel Dzemil",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "Tijd: na 16.30",
    meenemen: "ja",
    nieuw_appje: "ja",
    datum_opmerking: "vandaag",
    opmerkingen_klant: "geen opmerking",
    producten: "Proefrit aan huis: V20 pro rijklaar + kettingslot",
    totaal_prijs: 999.0,
    betaald_col: "factuur betaling aan deur",
    volledig_adres: "Marterrade 285, , 2544 MK, 's-Gravenhage",
    telefoon_raw: "31 06 11249439",
    order_id_shopify: "8084215464203",
    datum_iso: "2026-03-24T12:12:53+01:00",
    aantal_fietsen: 1,
    email: "dzemilnumanovic@hotmail.com",
    e164_raw: "31611249439",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
  {
    order_nummer: "#3646",
    naam: "Sabrina Khan",
    adres_url_raw: "https://maps.google.com/maps?q=Tiarastraat 19, , 1336 SG, Almere",
    bel_raw: "Bel Sabrina",
    aankomsttijd_slot: null,
    bezorgtijd_voorkeur: "geen",
    meenemen: "nee",
    nieuw_appje: "nee",
    datum_opmerking: "vandaag",
    opmerkingen_klant: "geen opmerking",
    producten: "Reparatie aan huis: Draaigashendel monteren (geen voorrijkosten)",
    totaal_prijs: 35.0,
    betaald_col: "factuur betaling aan deur",
    volledig_adres: "Tiarastraat 19, , 1336 SG, Almere",
    telefoon_raw: "642465474",
    order_id_shopify: "8084658815243",
    datum_iso: "2026-03-24T15:48:09+01:00",
    aantal_fietsen: 1,
    email: "sabrina.h.z.88@gmail.com",
    e164_raw: "31642465474",
    mp_tags_raw: "geen tag",
    model: null,
    serienummer: null,
  },
];

function rowToPayload(r) {
  const mp = isMpOrderNum(r.order_nummer);
  const source = mp ? "mp" : "shopify";
  const type = "verkoop";

  const adres_url = mapsUrl(r.adres_url_raw || r.volledig_adres);
  const e164 = normPhone(r.e164_raw || r.telefoon_raw).e164;
  const bel_link = belLink(r.e164_raw || r.telefoon_raw);

  const { betaald, betaalmethode } = parseBetaaldCol(r.betaald_col);

  let mp_tags = null;
  if (mp) mp_tags = "MP";
  else if (String(r.mp_tags_raw ?? "").trim().toLowerCase() === "mp") mp_tags = "MP";

  return {
    source,
    type,
    status: "ritjes_vandaag",
    order_nummer: r.order_nummer.trim(),
    naam: r.naam.trim(),
    adres_url,
    bel_link,
    aankomsttijd_slot: r.aankomsttijd_slot || null,
    bezorgtijd_voorkeur: r.bezorgtijd_voorkeur || null,
    meenemen_in_planning: parseJaNee(r.meenemen) ?? true,
    nieuw_appje_sturen: parseJaNee(r.nieuw_appje),
    datum_opmerking: r.datum_opmerking || null,
    opmerkingen_klant: r.opmerkingen_klant || null,
    producten: r.producten || null,
    bestelling_totaal_prijs: r.totaal_prijs != null ? Number(r.totaal_prijs) : null,
    betaald,
    betaalmethode: betaalmethode,
    volledig_adres: r.volledig_adres || null,
    telefoon_nummer: r.telefoon_raw ? String(r.telefoon_raw).trim() : null,
    telefoon_e164: e164,
    order_id: r.order_id_shopify ? String(r.order_id_shopify) : null,
    datum: parseDatum(r.datum_iso),
    aantal_fietsen: r.aantal_fietsen != null ? Number(r.aantal_fietsen) : null,
    email: r.email || null,
    model: r.model || null,
    serienummer: r.serienummer || null,
    mp_tags,
    link_aankoopbewijs: null,
    bezorger_naam: null,
    betaald_bedrag: null,
    afgerond_at: null,
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
    const order_nummer = String(r.order_nummer).trim();
    const payloadBase = rowToPayload(r);

    for (const owner_email of owners) {
      const { data: existing } = await supabase
        .from("orders")
        .select("id, status")
        .eq("owner_email", owner_email)
        .eq("order_nummer", order_nummer)
        .maybeSingle();

      if (existing?.id) {
        summary.skipped.push({ order_nummer, owner_email, id: existing.id, status: existing.status });
        continue;
      }

      const row = { ...payloadBase, owner_email };
      const { data, error } = await supabase
        .from("orders")
        .insert(row)
        .select("id, owner_email, order_nummer, status")
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
