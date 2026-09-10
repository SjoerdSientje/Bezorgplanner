-- Reserveringen: geplande orders houden voorraad vast zonder meteen af te schrijven.

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  inventory_product_id uuid NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  source text NOT NULL CHECK (source IN ('shopify', 'marktplaats')),
  external_order_id text NOT NULL,
  order_db_id uuid,
  order_nummer text,
  customer_name text,
  customer_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_inventory_reservations_order_product
    UNIQUE (owner_email, source, external_order_id, inventory_product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_owner_product
  ON inventory_reservations (owner_email, inventory_product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_owner_order
  ON inventory_reservations (owner_email, source, external_order_id);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order_db
  ON inventory_reservations (order_db_id)
  WHERE order_db_id IS NOT NULL;

DROP TRIGGER IF EXISTS inventory_reservations_updated_at ON inventory_reservations;
CREATE TRIGGER inventory_reservations_updated_at
  BEFORE UPDATE ON inventory_reservations
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
