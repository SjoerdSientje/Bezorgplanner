-- Bezorgplanner: sheets als tabellen en views
-- Kolommen per sheet exact zoals opgegeven. Run in Supabase → SQL Editor.

-- ============================================
-- 1. ORDERS (alle velden voor Ritjes vandaag + Bezorgde + MP)
-- ============================================
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('shopify', 'mp')),
  type text NOT NULL CHECK (type IN ('verkoop', 'reparatie_ophalen', 'reparatie_terugbrengen', 'reparatie_deur', 'mp_winkel')),
  status text NOT NULL DEFAULT 'ritjes_vandaag' CHECK (status IN ('ritjes_vandaag', 'gepland', 'bezorgd', 'mp_orders')),

  -- Ritjes voor vandaag (en doorgevoerd naar andere sheets)
  order_nummer text,
  naam text,
  adres_url text,
  bel_link text,
  bezorgtijd_voorkeur text,
  meenemen_in_planning boolean DEFAULT true,
  nieuw_appje_sturen boolean,
  datum_opmerking text,
  opmerkingen_klant text,
  producten text,
  bestelling_totaal_prijs numeric(10,2),
  betaald boolean,
  volledig_adres text,
  telefoon_nummer text,
  order_id text,
  datum date,
  aantal_fietsen int,
  email text,
  telefoon_e164 text,
  model text,
  serienummer text,
  link_aankoopbewijs text,

  -- Afronden (Bezorgde orders / MP orders)
  bezorger_naam text,
  betaalmethode text,
  betaald_bedrag numeric(10,2),
  afgerond_at timestamptz,

  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_datum ON orders(datum);
CREATE INDEX idx_orders_source ON orders(source);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_order_id ON orders(order_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================
-- 2. PLANNING_SLOTS (Bezorgplanner per stop)
-- ============================================
CREATE TABLE planning_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  datum date NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  volgorde int NOT NULL,
  aankomsttijd text,
  tijd_opmerking text,
  status text NOT NULL DEFAULT 'gepland' CHECK (status IN ('gepland', 'onderweg', 'afgerond')),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX idx_planning_slots_datum_order ON planning_slots(datum, order_id);
CREATE INDEX idx_planning_slots_datum ON planning_slots(datum);
CREATE INDEX idx_planning_slots_order ON planning_slots(order_id);

-- ============================================
-- 3. STARTTIJD (één instelling, geen aparte sheet)
-- ============================================
CREATE TABLE settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now() NOT NULL
);

INSERT INTO settings (key, value) VALUES ('default_start_tijd', '10:30')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 4. VIEW: RITJES VOOR VANDAAG (alle kolommen zoals in sheet)
-- ============================================
CREATE OR REPLACE VIEW ritjes_vandaag AS
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
  created_at
FROM orders
WHERE status = 'ritjes_vandaag'
ORDER BY created_at DESC;

-- ============================================
-- 5. VIEW: BEZORGPLANNER (kolommen zoals in sheet)
-- ============================================
CREATE OR REPLACE VIEW bezorgplanner_view AS
SELECT
  ps.id AS slot_id,
  o.order_nummer AS "Order nummer",
  o.naam AS "Naam",
  ps.aankomsttijd AS "Aankomsttijd",
  ps.tijd_opmerking AS "Tijd opmerking",
  o.adres_url AS "Adress URL",
  o.bel_link AS "Bel link",
  o.bestelling_totaal_prijs AS "Bestelling Totaal Prijs",
  o.betaald AS "Betaald?",
  o.aantal_fietsen AS "Aantal fietsen",
  o.producten AS "Product(en)",
  o.opmerkingen_klant AS "Opmerking klant",
  o.volledig_adres AS "Volledig adress",
  o.telefoon_nummer AS "Ingevuld Telefoon nummer",
  o.order_nummer AS "Order Nummer",
  o.email AS "Email",
  o.link_aankoopbewijs AS "Link Aankoopbewijs",
  ps.datum,
  ps.volgorde,
  ps.status AS slot_status,
  o.id AS order_id
FROM planning_slots ps
JOIN orders o ON o.id = ps.order_id
ORDER BY ps.datum, ps.volgorde;

-- ============================================
-- 6. VIEW: BEZORGDE ORDERS (kolommen zoals in sheet)
-- ============================================
CREATE OR REPLACE VIEW bezorgde_orders AS
SELECT
  order_nummer AS "Order Nummer",
  naam AS "Naam",
  bezorger_naam AS "Bezorger",
  betaalmethode AS "Hoe is er betaald?",
  betaald_bedrag AS "Betaald bedrag",
  (afgerond_at::date) AS "Bezorg Datum",
  producten AS "Product(en)",
  bestelling_totaal_prijs AS "Bestelling Totaal Prijs",
  volledig_adres AS "Volledig adress",
  telefoon_nummer AS "Telefoon nummer",
  order_id AS "Order ID",
  aantal_fietsen AS "Aantal fietsen",
  email AS "Email",
  betaalmethode AS "Betaalmethode",
  telefoon_e164 AS "Nummer in E.164 formaat",
  id
FROM orders
WHERE source = 'shopify' AND status = 'bezorgd'
ORDER BY afgerond_at DESC NULLS LAST;

-- ============================================
-- 7. VIEW: MP ORDERS (kolommen zoals in sheet)
-- ============================================
CREATE OR REPLACE VIEW mp_orders AS
SELECT
  order_nummer AS "Order Nummer",
  naam AS "Naam",
  bezorger_naam AS "Bezorger",
  betaalmethode AS "Hoe is er betaald?",
  betaald_bedrag AS "Betaald bedrag",
  datum AS "Bezorgdatum",
  telefoon_nummer AS "Telefoonnummer",
  producten AS "Product(en)",
  bestelling_totaal_prijs AS "Totaal Prijs",
  volledig_adres AS "Adres",
  email AS "Email",
  aantal_fietsen AS "Aantal Fietsen",
  telefoon_e164 AS "Nummer in E.164",
  link_aankoopbewijs AS "Link Aankoopbewijs",
  id
FROM orders
WHERE source = 'mp'
ORDER BY created_at DESC;

-- ============================================
-- 8. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on orders" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on planning_slots" ON planning_slots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on settings" ON settings FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE orders IS 'Alle orders; kolommen voor Ritjes vandaag, Bezorgde orders en MP orders.';
COMMENT ON TABLE planning_slots IS 'Bezorgplanner: volgorde en aankomsttijd per order per dag.';
COMMENT ON TABLE settings IS 'Instellingen o.a. default_start_tijd (10:30).';
