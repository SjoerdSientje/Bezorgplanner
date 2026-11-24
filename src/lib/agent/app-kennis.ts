/**
 * Zoekbare app-kennis voor de planning-agent.
 * Combineert handleiding + process-blokken uit de appflow.
 */

import {
  HANDLEIDING_SECTIONS,
  type HandleidingSection,
} from "@/lib/handleiding-content";

export type AppKennisBlok = {
  id: string;
  title: string;
  keywords: string[];
  body: string;
};

/** Processen die in de code zitten maar (deels) buiten de handleiding vallen. */
export const APP_PROCESS_BLOKKEN: AppKennisBlok[] = [
  {
    id: "ophalen-wachtkamer",
    title: "Ophaalorder afronden → wachtkamer",
    keywords: [
      "ophalen",
      "opgehaald",
      "wachtkamer",
      "meegenomen",
      "sleutels",
      "nfc",
      "accu",
      "checklist",
    ],
    body: `Bij afronden van een reparatie-ophaalorder (type reparatie_ophalen) gaat de order naar status "opgehaald" (wachtkamer), niet naar bezorgd.
De bezorger vult "Meegenomen bij ophalen?" in: per item Ja of Niet van toepassing. Bij Ja moet 1 of 2 stuks gekozen (ringslotsleutels, accusleutels, kettingslotsleutels, lockboxsleutels, accu, NFC-kaarten). Alleen Ja-items (met aantal) worden opgeslagen in ophalen_meegenomen_json.
opgehaald_at / opgehaald_door worden gezet. Er wordt géén eindfactuur gemaakt bij ophalen; voorrij komt later op de eindfactuur/offerte.`,
  },
  {
    id: "ophaal-vervolg",
    title: "Opgehaalde orders: terugbrengen of winkelafhaal",
    keywords: [
      "ophaal-orders",
      "terugbrengen",
      "winkelafhaal",
      "offerte",
      "estimate",
      "factureer",
      "heropen",
    ],
    body: `Op /reparaties/ophaal-orders staan opgehaalde fietsen.
Terugbrengen: nieuwe terugbreng-order (ritjes vandaag), duale voorrijkosten, factuurregels zoals bij reparatie aanmaken, meegenomen items opnieuw afvinken, Moneybird-factuur volgens betaalwijze.
Winkelafhaal: zelfde order naar bezorgd, conceptofferte (Moneybird estimate) aanmaken (niet meteen verzonden). Binnen 7 dagen: factureer of heropen. Product-/factuur-UI is gelijk aan reparatie nieuw (standaard, Shopify, vrije tekst, arbeid, voorrij).`,
  },
  {
    id: "reparatie-aanmaken",
    title: "Reparatie-order aanmaken",
    keywords: [
      "reparatie",
      "nieuw",
      "factuur",
      "contant",
      "aan huis",
      "terugbrengen",
      "shopify",
      "arbeid",
      "voorrij",
    ],
    body: `Reparatie aanmaken: soort ophalen / terugbrengen / aan huis.
Producten: standaardreparatie, Shopify-product, vrije tekstregel; arbeidskosten en voorrij in de factuurtabel.
Ophalen: geen factuurregels verplicht; vrije tekst in productenkolom; Moneybird-contact kan wel aangemaakt worden.
Terugbrengen met factuur: factuur wordt bij opslaan aangemaakt en verstuurd; voorraad meteen afgeschreven; order daarna niet meer vrij aanpasbaar.
Aan huis: factuur pas bij afronden door de bezorger.`,
  },
  {
    id: "afronden-bezorging",
    title: "Bezorging / reparatie afronden",
    keywords: [
      "afronden",
      "bezorger",
      "contant",
      "factuur",
      "serienummer",
      "garantie",
      "whatsapp",
    ],
    body: `Afronden via /bezorgplanner/afronden/[orderId].
Bezorger, betaaloptie, eventueel bedrag. MP: serienummer (tenzij geen_garantie).
Reparatie aan huis: producten/kosten + factuur of contant; factuur naar Moneybird bij afronden indien gekozen.
Shopify/MP: status naar bezorgd/mp_orders; aankoopbewijs/WhatsApp waar van toepassing.
Reparatie terugbrengen: checklist "teruggegeven" voor items die bij ophalen mee waren.`,
  },
  {
    id: "shopify-moneybird",
    title: "Shopify ↔ Moneybird",
    keywords: [
      "shopify",
      "moneybird",
      "factuur",
      "credit",
      "bijfactuur",
      "betaald",
      "concept",
      "webhook",
    ],
    body: `Shopify-orders aanpassen in Shopify (niet in de planner), behalve als al afgehandeld.
Onbetaald: factuur wordt bijgewerkt (concept of verstuurd zonder opnieuw mailen).
Betaald + concept: zelfde bedrag → update; ander bedrag → correctie-factuur.
Betaald + verstuurd: hoofdfactuur blijft; credit/bijfactuur-concepten.
Annuleren/refund: zie handleiding Sjoerd/Mootje. Voorraad wijzigt niet meer na afhandeling.
Onder €490 + fulfilled: conceptfactuur kan automatisch gemaild worden. ≥ €490: handmatig versturen in Moneybird koppelt o.a. voorraad.`,
  },
  {
    id: "moneybird-acties-agent",
    title: "Moneybird via Sientje (agent)",
    keywords: [
      "stuur factuur",
      "verstuur factuur",
      "moneybird",
      "send_invoice",
      "e-mail",
    ],
    body: `De agent kan voor een bestaande reparatie- of Shopify-order een Moneybird-conceptfactuur aanmaken/bijwerken (maak_moneybird_factuur) en die per e-mail versturen (stuur_moneybird_factuur of ook_versturen).
Regels komen uit de order (producten/reparatieregels). Geen vrije factuur zonder order. MP/winkel meestal handmatig. Voor "kan Moneybird X?" gebruikt de agent raadpleeg_moneybird_api.`,
  },
  {
    id: "planning-ritjes",
    title: "Ritjes, route en tijdsloten",
    keywords: [
      "ritjes",
      "route",
      "routific",
      "tijdslot",
      "aankomsttijd",
      "planning",
      "meenemen",
    ],
    body: `Ritjes voor vandaag: orders met meenemen_in_planning en datum-opmerking vandaag/morgen.
Route genereren (Routific): vertrek per route, max load, 20 min per stop, PDOK-geocoding. Tijdsloten = 2-uursvenster rond verwachte aankomst (45 min voor / 75 min na).
Agent mag tijdsloten zetten/wissen via set_aankomsttijd_slots alleen na expliciete bevestiging.
Planning goedkeuren is een aparte stap (planning-sheet).`,
  },
  {
    id: "voorraad",
    title: "Voorraad & koppelingen",
    keywords: [
      "voorraad",
      "inkomende",
      "reservering",
      "levertijd",
      "restock",
      "shopify product",
    ],
    body: `Voorraadregels gekoppeld aan Shopify-producten. Inkomende leveringen tonen wat eraan komt; bij aankomst bijschrijven.
Handmatig aanpassen per regel of via Voorraad beheren. Geel driehoekje = reserveringen.
Levertijd/restock gaat mee naar de website voor gekoppelde producten.
Reparatie terugbrengen schrijft voorraad af bij aanmaken.`,
  },
];

function handleidingToBlokken(sections: HandleidingSection[]): AppKennisBlok[] {
  return sections.flatMap((s) =>
    s.blocks.map((b, i) => ({
      id: `handleiding-${s.id}-${i}`,
      title: b.heading ? `${s.title}: ${b.heading}` : s.title,
      keywords: [...s.keywords, s.title, b.heading ?? ""],
      body: b.body,
    }))
  );
}

export function allAppKennisBlokken(): AppKennisBlok[] {
  return [...handleidingToBlokken(HANDLEIDING_SECTIONS), ...APP_PROCESS_BLOKKEN];
}

/** Zoek relevante kennisblokken op query (max N). */
export function zoekAppKennis(
  query: string,
  limit = 6
): AppKennisBlok[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return allAppKennisBlokken().slice(0, limit);
  }
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  const scored = allAppKennisBlokken().map((blok) => {
    const hay = [blok.title, ...blok.keywords, blok.body]
      .join("\n")
      .toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 1;
      if (blok.title.toLowerCase().includes(w)) score += 2;
      if (blok.keywords.some((k) => k.toLowerCase().includes(w))) score += 2;
    }
    if (hay.includes(q)) score += 3;
    return { blok, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.blok);
}

export function formatKennisVoorTool(blokken: AppKennisBlok[]): string {
  if (blokken.length === 0) {
    return "Geen relevante app-kennis gevonden voor deze query.";
  }
  return blokken
    .map((b) => `### ${b.title}\n${b.body}`)
    .join("\n\n");
}
