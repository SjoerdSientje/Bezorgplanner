-- Terug naar één voorraadregel per Shopify-variant.

DROP INDEX IF EXISTS uq_inventory_products_owner_group_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_products_owner_variant
  ON inventory_products (owner_email, shopify_variant_id);
