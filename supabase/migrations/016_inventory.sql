-- Voorraadbeheer: producten uit Shopify + mutatielog.

CREATE TABLE IF NOT EXISTS inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  shopify_product_id bigint NOT NULL,
  shopify_variant_id bigint NOT NULL,
  title text NOT NULL,
  variant_title text,
  product_type text,
  vendor text,
  tags text,
  category text NOT NULL DEFAULT 'onderdeel' CHECK (category IN ('fiets', 'onderdeel', 'overig')),
  stock_quantity integer NOT NULL DEFAULT 10 CHECK (stock_quantity >= 0),
  image_url text,
  last_mutation_source text CHECK (last_mutation_source IN ('shopify', 'marktplaats', 'winkel', 'handmatig')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_products_owner_variant
  ON inventory_products (owner_email, shopify_variant_id);

CREATE INDEX IF NOT EXISTS idx_inventory_products_owner_category
  ON inventory_products (owner_email, category);

CREATE INDEX IF NOT EXISTS idx_inventory_products_owner_stock
  ON inventory_products (owner_email, stock_quantity);

CREATE TABLE IF NOT EXISTS inventory_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  product_id uuid NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  mutation_type text NOT NULL CHECK (mutation_type IN ('inkomend', 'uitgaand', 'correctie')),
  quantity integer NOT NULL,
  stock_before integer NOT NULL,
  stock_after integer NOT NULL,
  source text NOT NULL CHECK (source IN ('shopify', 'marktplaats', 'winkel', 'handmatig')),
  note text,
  order_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_mutations_owner_created
  ON inventory_mutations (owner_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_mutations_product
  ON inventory_mutations (product_id, created_at DESC);

-- Voorkom dubbele voorraadaftrek bij webhook-retries.
CREATE TABLE IF NOT EXISTS inventory_order_deductions (
  owner_email text NOT NULL,
  source text NOT NULL CHECK (source IN ('shopify', 'marktplaats')),
  external_order_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_email, source, external_order_id)
);

DROP TRIGGER IF EXISTS inventory_products_updated_at ON inventory_products;
CREATE TRIGGER inventory_products_updated_at
  BEFORE UPDATE ON inventory_products
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_order_deductions ENABLE ROW LEVEL SECURITY;
