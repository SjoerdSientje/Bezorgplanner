# Database (sheets) aanmaken in Supabase

## Stap 1: SQL uitvoeren

1. Ga naar [Supabase Dashboard](https://supabase.com/dashboard) → jouw project.
2. Open **SQL Editor**.
3. Voer de migraties in volgorde uit: open `001_sheets.sql`, kopieer de inhoud, plak in de SQL Editor, Run. Doe daarna hetzelfde met `002_add_mp_tags.sql` en `003_aankomsttijd_slot.sql`.

Als je eerder een oudere versie van de migratie had gedraaid: drop eerst de bestaande views en tabellen (in omgekeerde volgorde), of maak een nieuw Supabase-project.

## Wat er wordt aangemaakt

| Sheet | In Supabase | Kolommen |
|-------|-------------|----------|
| Ritjes voor vandaag | View `ritjes_vandaag` | Order Nummer, Naam, Adress URL, Bel link, Aankomsttijd, Bezorgtijd voorkeur, Meenemen in planning, Nieuw appje sturen?, Datum opmerking, Opmerkingen klant, Product(en), Bestelling Totaal Prijs, Betaald?, Volledig adress, Ingevuld Telefoon nummer, Order ID, Datum, Aantal fietsen, Email, Nummer in E.164 formaat, Model, Serienummer |
| Bezorgplanner | Tabel `planning_slots` + view `bezorgplanner_view` | Order nummer, Naam, Aankomsttijd, Tijd opmerking, Adress URL, Bel link, Bestelling Totaal Prijs, Betaald?, Aantal fietsen, Product(en), Opmerking klant, Volledig adress, Ingevuld Telefoon nummer, Order Nummer, Email, Link Aankoopbewijs |
| Bezorgde orders | View `bezorgde_orders` | Order Nummer, Naam, Bezorger, Hoe is er betaald?, Betaald bedrag, Bezorg Datum, Product(en), Bestelling Totaal Prijs, Volledig adress, Telefoon nummer, Order ID, Aantal fietsen, Email, Betaalmethode, Nummer in E.164 formaat |
| MP orders | View `mp_orders` | Order Nummer, Naam, Bezorger, Hoe is er betaald?, Betaald bedrag, Bezorgdatum, Telefoonnummer, Product(en), Totaal Prijs, Adres, Email, Aantal Fietsen, Nummer in E.164, Link Aankoopbewijs |
| Starttijd | Tabel `settings` (geen aparte sheet) | Eén waarde: `default_start_tijd` = 10:30 |

## Tabellen

- **orders** – Eén tabel met alle kolommen voor ritjes vandaag, bezorgde orders en MP orders. `status`: `ritjes_vandaag` \| `gepland` \| `bezorgd` \| `mp_orders`.
- **planning_slots** – Per dag: volgorde, aankomsttijd, tijd opmerking, koppeling naar order.
- **settings** – Alleen starttijd (key: `default_start_tijd`, value: `10:30`).

RLS staat aan met (voor nu) permissive policies.
