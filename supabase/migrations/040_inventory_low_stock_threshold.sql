-- Drempel voor het "voorraad laag"-WhatsApp-appje per voorraadregel.
-- NULL = standaard (3). 0 = geen laag-appje.
-- Uitverkocht-appje (verkoopbaar ≤ 0) gaat altijd, ongeacht deze kolom.

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer
  CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0);
