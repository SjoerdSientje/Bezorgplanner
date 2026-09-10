-- Restock-datum apart van levertijd-tekst (app → Shopify metafield custom.restock_datum).

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS restock_datum date;
