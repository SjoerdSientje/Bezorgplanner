-- Backfill existing Shopify orders to all allowed accounts.
-- Needed once after introducing owner_email scoping so both accounts
-- start with the same Shopify base dataset.

INSERT INTO orders (
  owner_email,
  source,
  type,
  status,
  order_nummer,
  naam,
  adres_url,
  bel_link,
  bezorgtijd_voorkeur,
  meenemen_in_planning,
  nieuw_appje_sturen,
  datum_opmerking,
  opmerkingen_klant,
  producten,
  bestelling_totaal_prijs,
  betaald,
  volledig_adres,
  telefoon_nummer,
  order_id,
  datum,
  aantal_fietsen,
  email,
  telefoon_e164,
  model,
  serienummer,
  mp_tags,
  link_aankoopbewijs,
  bezorger_naam,
  betaalmethode,
  betaald_bedrag,
  afgerond_at,
  line_items_json
)
SELECT
  target.owner_email,
  o.source,
  o.type,
  o.status,
  o.order_nummer,
  o.naam,
  o.adres_url,
  o.bel_link,
  o.bezorgtijd_voorkeur,
  o.meenemen_in_planning,
  o.nieuw_appje_sturen,
  o.datum_opmerking,
  o.opmerkingen_klant,
  o.producten,
  o.bestelling_totaal_prijs,
  o.betaald,
  o.volledig_adres,
  o.telefoon_nummer,
  o.order_id,
  o.datum,
  o.aantal_fietsen,
  o.email,
  o.telefoon_e164,
  o.model,
  o.serienummer,
  o.mp_tags,
  o.link_aankoopbewijs,
  o.bezorger_naam,
  o.betaalmethode,
  o.betaald_bedrag,
  o.afgerond_at,
  o.line_items_json
FROM orders o
CROSS JOIN (
  VALUES
    ('info@koopjefatbike.nl'::text),
    ('malyar@aiventive.nl'::text)
) AS target(owner_email)
WHERE o.source = 'shopify'
  AND o.owner_email = 'info@koopjefatbike.nl'
  AND NOT EXISTS (
    SELECT 1
    FROM orders x
    WHERE x.owner_email = target.owner_email
      AND x.source = 'shopify'
      AND x.order_id = o.order_id
  );
