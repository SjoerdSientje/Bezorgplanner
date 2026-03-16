-- Kolom MP tags toevoegen (leeg voor Shopify-orders)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mp_tags text;

COMMENT ON COLUMN orders.mp_tags IS 'Alleen voor MP-orders; bij Shopify leeg.';

-- View ritjes_vandaag uitbreiden met MP tags
DROP VIEW IF EXISTS ritjes_vandaag;

CREATE VIEW ritjes_vandaag AS
SELECT
  id,
  order_nummer AS "Order Nummer",
  naam AS "Naam",
  adres_url AS "Adress URL",
  bel_link AS "Bel link",
  NULL::text AS "Aankomsttijd (HH:MM - HH:MM)",
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
