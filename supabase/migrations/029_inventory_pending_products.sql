-- Wachtrij voor nieuwe actieve Shopify-producten (handmatige voorraad-goedkeuring).

CREATE TABLE IF NOT EXISTS inventory_pending_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  shopify_product_id bigint NOT NULL,
  shopify_variant_ids bigint[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  category text NOT NULL DEFAULT 'overig'
    CHECK (category IN ('fiets', 'onderdeel', 'accessoire', 'overig')),
  collection_handles text[] NOT NULL DEFAULT '{}',
  image_url text,
  ai_suggestion jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_inventory_pending_owner_shopify_product
    UNIQUE (owner_email, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_pending_owner_created
  ON inventory_pending_products (owner_email, created_at DESC);

DROP TRIGGER IF EXISTS inventory_pending_products_updated_at ON inventory_pending_products;
CREATE TRIGGER inventory_pending_products_updated_at
  BEFORE UPDATE ON inventory_pending_products
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

ALTER TABLE inventory_pending_products ENABLE ROW LEVEL SECURITY;
