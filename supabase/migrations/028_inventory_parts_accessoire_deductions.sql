-- Categorie accessoire + vaste Shopify→voorraad aftrekregels (onderdelen/accessoires).

ALTER TABLE inventory_products
  DROP CONSTRAINT IF EXISTS inventory_products_category_check;

ALTER TABLE inventory_products
  ADD CONSTRAINT inventory_products_category_check
  CHECK (category IN ('fiets', 'onderdeel', 'accessoire', 'overig'));

CREATE TABLE IF NOT EXISTS inventory_shopify_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  shopify_product_id bigint NOT NULL,
  shopify_variant_id bigint,
  kind text NOT NULL CHECK (kind IN ('exclude', 'deduct')),
  inventory_product_id uuid REFERENCES inventory_products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_shopify_deductions_kind_check2 CHECK (
    (kind = 'exclude' AND inventory_product_id IS NULL)
    OR (kind = 'deduct' AND inventory_product_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_shopify_deductions_exclude
  ON inventory_shopify_deductions (owner_email, shopify_product_id)
  WHERE kind = 'exclude';

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_shopify_deductions_deduct
  ON inventory_shopify_deductions (
    owner_email,
    shopify_product_id,
    COALESCE(shopify_variant_id, 0),
    inventory_product_id
  )
  WHERE kind = 'deduct';

CREATE INDEX IF NOT EXISTS idx_inventory_shopify_deductions_lookup
  ON inventory_shopify_deductions (owner_email, shopify_product_id);

ALTER TABLE inventory_shopify_deductions ENABLE ROW LEVEL SECURITY;
