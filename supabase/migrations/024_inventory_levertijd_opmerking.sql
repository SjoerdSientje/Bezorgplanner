-- Levertijd en opmerking per voorraadproduct (handmatig, blijft bij Shopify-sync).

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS levertijd text,
  ADD COLUMN IF NOT EXISTS opmerking text;
