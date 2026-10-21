/**
 * Inhoud van de Bezorgplanner-handleiding.
 * Taal: kort, voor medewerkers — geen tech-jargon.
 * Later bijwerken als de app verandert.
 */

export type HandleidingBlock = {
  /** Optionele tussenkop */
  heading?: string;
  body: string;
};

export type HandleidingSection = {
  id: string;
  title: string;
  /** Extra zoekwoorden */
  keywords: string[];
  blocks: HandleidingBlock[];
};

export const HANDLEIDING_SECTIONS: HandleidingSection[] = [
  {
    id: "sjoerd",
    title: "Sjoerd",
    keywords: [
      "shopify",
      "factuur",
      "voorraad",
      "inkomende levering",
      "nieuwe producten",
      "standaard inbegrepen",
      "levertijd",
      "restock",
      "opslaan",
      "sientje",
    ],
    blocks: [
      {
        heading: "Shopify-order aanpassen — wat gebeurt er?",
        body: "Pas orders altijd aan in Shopify (niet in de bezorgplanner), behalve als de order al afgehandeld is. Hieronder wat er dan automatisch gebeurt.",
      },
      {
        heading: "Nog niet betaald",
        body: "Of de factuur nu concept is of al verstuurd: de factuur wordt gewoon bijgewerkt. Geen aparte credit of bijfactuur. Is de factuur al verstuurd, dan wordt hij niet opnieuw gemaild — dat doe je zelf als dat nodig is.",
      },
      {
        heading: "Wel betaald, factuur nog concept",
        body: "Zelfde totaalbedrag → concept wordt bijgewerkt.\nAnder totaalbedrag → concept houdt het oude (betaalde) bedrag; er komt een aparte correctie-factuur voor het verschil (extra te betalen of terug).",
      },
      {
        heading: "Wel betaald, factuur al verstuurd",
        body: "Hoofdfactuur blijft staan. Er komen concepten: credit voor wat eraf gaat, bijfactuur voor wat erbij komt. Kenmerk verwijst naar de hoofdfactuur.",
      },
      {
        heading: "Order annuleren / volledig terugbetalen",
        body: "Onbetaald → factuur weg, voorraad terug (als die al was afgeschreven), order uit ritjes.\nBetaald → hoofdfactuur blijft, er komt een credit-concept. Voorraad wordt niet automatisch teruggezet.",
      },
      {
        heading: "Gedeeltelijke terugbetaling",
        body: "Er komt een credit-concept voor die terugbetaling. Voorraad alleen mee als die al was afgeschreven én de order nog niet afgehandeld is.",
      },
      {
        heading: "Afgehandeld = klaar",
        body: "Is de order afgehandeld (bezorgd/afgerond)? Dan wijzigt de voorraad niet meer bij productwijzigingen. Dat is bewust.",
      },
      {
        heading: "Inkomende leveringen",
        body: "In het voorraadsysteem kun je inkomende leveringen aanmaken (bijv. onderweg uit China). Zo ziet iedereen wat eraan komt.",
      },
      {
        heading: "Nieuwe producten",
        body: "Onder Nieuwe producten staan actieve webshop-producten die nog geen voorraadregel hebben (of nog niet gekoppeld zijn). Daar kun je ze makkelijk aanmaken of koppelen.",
      },
      {
        heading: "Standaard inbegrepen",
        body: "Hier stel je per fiets in wat er standaard meegaat. Fietspompjes, voorrekjes, achterzitjes e.d. hebben geen voorraadregel en worden niet van voorraad afgetrokken.\n\nOpslaan-knop staat BOVENAAN de pagina, Sientje!",
      },
      {
        heading: "Levertijd & restockdatum",
        body: "Aanpassen in voorraadbeheer. Dat gaat ook mee naar de website — voor elk product dat aan die voorraadregel hangt.",
      },
    ],
  },
  {
    id: "verkoop",
    title: "Verkoop",
    keywords: [
      "shopify",
      "marktplaats",
      "mp",
      "winkel",
      "pin",
      "factuur",
      "geplande",
      "bewerken",
    ],
    blocks: [
      {
        heading: "Shopify-orders",
        body: "Bestaande Shopify-orders altijd aanpassen in Shopify zelf. Gewoon de bestaande order bewerken — behalve als de order al afgehandeld is.",
      },
      {
        heading: "Marktplaats",
        body: "Nieuwe MP-order: via Marktplaats order.\nBewerken of verwijderen: in Geplande MP orders.",
      },
      {
        heading: "Verkoop in de winkel",
        body: "Moet de fiets bezorgd worden? → order aanmaken in Shopify.\nGeen bezorging? → factuur direct in Moneybird maken en versturen. Vergeet het factuurnummer niet op het pinapparaat!\n\nKlant wil wel bezorging maar alvast in de winkel afrekenen en een factuur? Dat mag gewoon.",
      },
    ],
  },
  {
    id: "reparaties",
    title: "Reparaties",
    keywords: [
      "reparatie",
      "offerte",
      "ophalen",
      "terugbrengen",
      "aan huis",
      "contant",
      "factuur",
      "geplande",
    ],
    blocks: [
      {
        heading: "Fiets naar de winkel / klant haalt op",
        body: "Fiets wordt gerepareerd, offerte maken, offertenummer op de reparatiekaart zetten.",
      },
      {
        heading: "Ophaalorder",
        body: "Klant wil ophalen laten doen → Reparatie aanmaken → ophaalorder.\nGeen factuur bij ophalen: ophaalkosten komen later op de eindfactuur na reparatie.",
      },
      {
        heading: "Fiets klaar",
        body: "Klant bellen.\nHaalt hij zelf op in de winkel? Offerte maken (ophalen erop zetten als nodig).\nWil hij terugbrengen? → Reparatie aanmaken → terugbrengorder.",
      },
      {
        heading: "Terugbrengorder — belangrijk",
        body: "Kies factuur of contant.\nVoorraad wordt meteen afgeschreven bij aanmaken. De order is daarna niet meer aanpasbaar — we gaan ervan uit dat de reparatie klaar is.\n\nKies je factuur? Factuur wordt meteen verstuurd bij opslaan (klant kan al betalen). Maak dus geen aparte factuur erbij!",
      },
      {
        heading: "Bewerken",
        body: "Bestaande reparatie-orders bewerken: in Geplande reparaties.",
      },
      {
        heading: "Reparatie aan huis",
        body: "Factuur pas bij afronden — dan weet je pas wat de bezorger echt heeft gedaan.",
      },
    ],
  },
  {
    id: "mootje",
    title: "De Mootje special",
    keywords: [
      "mootje",
      "factuur",
      "serienummer",
      "credit",
      "bijfactuur",
      "inkomende",
      "loods",
      "verzenden",
    ],
    blocks: [
      {
        heading: "Shopify wijzigen — jouw taak",
        body: "Zelfde regels als bij Sjoerd (onbetaald / betaald / concept / verstuurd / afgehandeld).\n\nJij zorgt dat de juiste concepten in Moneybird ook echt verstuurd worden.",
      },
      {
        heading: "Extra factuur omdat de order al betaald was",
        body: "Vaak komen er twee dingen: credit én/of bijfactuur naast de hoofdfactuur. Verstuur die concepten.\n\nDe hoofdfactuur is leidend voor voorraad. Is het nieuwe product een fiets? Vul het serienummer opnieuw in op de juiste factuur (zie hieronder).",
      },
      {
        heading: "Serienummer — waar?",
        body: "Normaal op de hoofdfactuur.\nAlleen als de hoofdfactuur al verstuurd én betaald is (die kun je niet meer wijzigen): serienummer op de nieuwe bijfactuur zetten.",
      },
      {
        heading: "Levering aannemen op de loods",
        body: "Kijk eerst of de levering onder Inkomende leveringen staat. Staat die er niet? Waarschijnlijk omdat Sjoerd lui is — even checken/aanmaken.\n\nStaat die er wél? Klik dat de levering binnen is. Alle producten uit die levering gaan automatisch bij de juiste voorraadregels.",
      },
      {
        heading: "Levertijd & restockdatum",
        body: "Aanpassen in voorraadbeheer → gaat ook naar de website voor alle gekoppelde producten.",
      },
    ],
  },
  {
    id: "bezorgers",
    title: "Bezorgers",
    keywords: ["afronden", "reparatie", "aan huis", "contant", "factuur", "deur"],
    blocks: [
      {
        heading: "Reparatie aan huis afronden",
        body: "Controleer of je de juiste producten en kosten hebt gekozen.",
      },
      {
        heading: "Contant of factuur?",
        body: "Contant → er gaat geen factuur naar de klant.\nKlant betaalt contant maar wil wél een factuur? Kies Factuur en onderaan Contant aan deur.",
      },
    ],
  },
  {
    id: "voorraad",
    title: "Voorraad algemeen",
    keywords: [
      "inkomende",
      "levertijd",
      "handmatig",
      "beheren",
      "geel",
      "driehoek",
      "reservering",
      "verkoopbaar",
      "lage voorraad",
    ],
    blocks: [
      {
        heading: "Inkomende leveringen",
        body: "Zie je onder Inkomende leveringen. Producten in zo’n levering krijgen op hun voorraadregel de verwachte levertijd — handig om te zien wanneer iets binnenkomt.",
      },
      {
        heading: "Voorraad handmatig aanpassen",
        body: "Per regel: knop Aanpassen.\nMeerdere producten tegelijk: knop Voorraad beheren.",
      },
      {
        heading: "Geel driehoekje",
        body: "Er zijn reserveringen. Klik erop om te zien hoeveel gereserveerd is en hoeveel er nog verkoopbaar is.",
      },
      {
        heading: "Lage voorraad",
        body: "Sjoerd krijgt een appje en regelt nieuwe voorraad.",
      },
    ],
  },
];

export function filterHandleidingSections(
  query: string
): HandleidingSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return HANDLEIDING_SECTIONS;

  const words = q.split(/\s+/).filter(Boolean);

  return HANDLEIDING_SECTIONS.map((section) => {
    const haystack = [
      section.title,
      ...section.keywords,
      ...section.blocks.flatMap((b) => [b.heading ?? "", b.body]),
    ]
      .join("\n")
      .toLowerCase();

    const sectionMatch = words.every((w) => haystack.includes(w));
    if (!sectionMatch) return null;

    const filteredBlocks = section.blocks.filter((b) => {
      const blockText = `${b.heading ?? ""} ${b.body}`.toLowerCase();
      return words.every((w) => blockText.includes(w) || haystack.includes(w));
    });

    // Als alleen de sectietitel/keywords matchen, toon alle blocks.
    const blocks =
      filteredBlocks.length > 0
        ? filteredBlocks
        : section.blocks;

    return { ...section, blocks };
  }).filter((s): s is HandleidingSection => s != null);
}
