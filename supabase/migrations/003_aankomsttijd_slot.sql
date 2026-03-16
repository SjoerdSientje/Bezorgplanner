-- Kolom voor gegenereerd tijdslot (Aankomsttijd HH:MM - HH:MM) op de order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS aankomsttijd_slot text;

COMMENT ON COLUMN orders.aankomsttijd_slot IS 'Gegenereerd tijdslot voor Ritjes voor vandaag: Aankomsttijd (HH:MM - HH:MM).';

-- View ritjes_vandaag: toon aankomsttijd_slot i.p.v. NULL
CREATE OR REPLACE VIEW ritjes_vandaag AS
SELECT
  id,
  order_nummer AS "Order Nummer",
  naam AS "Naam",
  adres_url AS "Adress URL",
  bel_link AS "Bel link",
  aankomsttijd_slot AS "Aankomsttijd (HH:MM - HH:MM)",
  bezorgtijd_voorkeur AS "Bezorgtijd voorkeur (opmerkingen van Sjoerd)",
  meenemen_in_planning AS "Meenemen in planning (anders veranderen naar nee)",
  nieuw_appje_sturen AS "Nieuw appje sturen?",
  datum_opmerking AS "Datum opmerking",
  opmerkingen_klant AS "Opmerkingen klant",
  producten AS "Product(en)",
  bestelling_totaal_prijs AS "Bestelling Totaal Prijs",
  betaald AS "Betaald?",
  volledig_adres AS "Volledig adress",
  telefoon_nummer AS "Ingevuld Telefoon nummer",
  order_id AS "Order ID",
  datum AS "Datum",
  aantal_fietsen AS "Aantal fietsen",
  email AS "Email",
  telefoon_e164 AS "Nummer in E.164 formaat",
  model AS "Model",
  serienummer AS "Serienummer",
  mp_tags AS "MP tags",
  created_at
FROM orders
WHERE status = 'ritjes_vandaag'
ORDER BY created_at DESC;
