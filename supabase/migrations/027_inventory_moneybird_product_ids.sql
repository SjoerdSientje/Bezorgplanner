-- Koppel Moneybird-producten (identifier = Shopify product-id) aan voorraadregels.
-- Eén voorraadrij kan meerdere Moneybird-producten hebben (fysieke fiets + family/combi-overlay).

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS moneybird_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_inventory_products_moneybird_product_ids
  ON inventory_products USING gin (moneybird_product_ids);
