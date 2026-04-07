-- Pakketjes-wachtrij: Shopify-webhook slaat orders < €500 hier op per account.
-- "Pakketjes afgerond" wist alle rijen voor het ingelogde account.

CREATE TABLE IF NOT EXISTS pakketjes_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  shopify_order_id text NOT NULL,
  order_nummer text,
  naam text,
  adres text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  totaal_prijs numeric(10, 2) NOT NULL,
  fulfillment_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pakketjes_orders_owner_shopify
  ON pakketjes_orders (owner_email, shopify_order_id);

CREATE INDEX IF NOT EXISTS idx_pakketjes_orders_owner_created
  ON pakketjes_orders (owner_email, created_at);

DROP TRIGGER IF EXISTS pakketjes_orders_updated_at ON pakketjes_orders;
CREATE TRIGGER pakketjes_orders_updated_at
  BEFORE UPDATE ON pakketjes_orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

ALTER TABLE pakketjes_orders ENABLE ROW LEVEL SECURITY;

-- Na "Pakketjes afgerond": negeer Shopify-orders met created_at vóór dit moment (geen re-import).
CREATE TABLE IF NOT EXISTS pakketjes_owner_cutoff (
  owner_email text PRIMARY KEY,
  ignore_shopify_created_before timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pakketjes_cutoff_owner ON pakketjes_owner_cutoff (owner_email);

ALTER TABLE pakketjes_owner_cutoff ENABLE ROW LEVEL SECURITY;
