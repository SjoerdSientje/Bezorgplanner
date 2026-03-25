-- Instelbare regels voor standaard inbegrepen items per fiets (producten-popup, paklijst).
-- Eén rij; JSON komt overeen met ProductDefaultItemsRulesV1 in de app.

CREATE TABLE IF NOT EXISTS product_default_items_rules (
  id text PRIMARY KEY DEFAULT 'default',
  rules jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE product_default_items_rules IS 'Regels: welke standaard items bij welk model in welke levering (volledig rijklaar / in doos).';
