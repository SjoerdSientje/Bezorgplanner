-- Reparaties: prijzenlijst, voorrijkosten, order-meta (contant/factuur, producten onbekend).

-- orders.source: 'reparatie' toevoegen
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_source_check
  CHECK (source IN ('shopify', 'mp', 'reparatie'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reparatie_betaalwijze text
    CHECK (reparatie_betaalwijze IS NULL OR reparatie_betaalwijze IN ('contant', 'factuur')),
  ADD COLUMN IF NOT EXISTS producten_nog_niet_bekend boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moneybird_invoice_id text,
  ADD COLUMN IF NOT EXISTS voorrij_km numeric,
  ADD COLUMN IF NOT EXISTS voorrij_bedrag numeric,
  ADD COLUMN IF NOT EXISTS reparatie_regels_json jsonb;

CREATE TABLE IF NOT EXISTS reparatie_standaard_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  naam text NOT NULL,
  onderdeel_naam text,
  onderdeel_prijs_incl numeric NOT NULL DEFAULT 0 CHECK (onderdeel_prijs_incl >= 0),
  shopify_product_id bigint,
  shopify_variant_id bigint,
  arbeid_uren numeric NOT NULL DEFAULT 0 CHECK (arbeid_uren >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reparatie_standaard_owner
  ON reparatie_standaard_items (owner_email, active, sort_order);

CREATE TABLE IF NOT EXISTS reparatie_voorrijkosten_settings (
  owner_email text PRIMARY KEY,
  basis_eur numeric NOT NULL DEFAULT 25 CHECK (basis_eur >= 0),
  per_km_eur numeric NOT NULL DEFAULT 1 CHECK (per_km_eur >= 0),
  afronding_eur numeric NOT NULL DEFAULT 5 CHECK (afronding_eur > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reparatie_standaard_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reparatie_voorrijkosten_settings ENABLE ROW LEVEL SECURITY;
