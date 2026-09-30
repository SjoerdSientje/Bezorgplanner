-- Meerdere Shopify-onderdelen per standaardreparatie.
ALTER TABLE reparatie_standaard_items
  ADD COLUMN IF NOT EXISTS onderdelen_json jsonb NOT NULL DEFAULT '[]'::jsonb;
