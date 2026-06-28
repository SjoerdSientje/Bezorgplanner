-- Groepeer fietsen op model + kleur (niet per losse Shopify-variant).

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS group_key text,
  ADD COLUMN IF NOT EXISTS model_name text,
  ADD COLUMN IF NOT EXISTS color_name text,
  ADD COLUMN IF NOT EXISTS shopify_variant_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE inventory_products
SET group_key = 'variant:' || shopify_variant_id::text,
    shopify_variant_ids = jsonb_build_array(shopify_variant_id)
WHERE group_key IS NULL;

ALTER TABLE inventory_products
  ALTER COLUMN group_key SET NOT NULL;

DROP INDEX IF EXISTS uq_inventory_products_owner_variant;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_products_owner_group_key
  ON inventory_products (owner_email, group_key);

CREATE INDEX IF NOT EXISTS idx_inventory_products_variant_ids
  ON inventory_products USING gin (shopify_variant_ids);
