-- Reparatie-orders: voorraadaftrek-bron 'reparatie' toestaan.
ALTER TABLE inventory_order_deductions
  DROP CONSTRAINT IF EXISTS inventory_order_deductions_source_check;

ALTER TABLE inventory_order_deductions
  ADD CONSTRAINT inventory_order_deductions_source_check
  CHECK (source IN ('shopify', 'marktplaats', 'moneybird', 'reparatie'));

ALTER TABLE inventory_mutations
  DROP CONSTRAINT IF EXISTS inventory_mutations_source_check;

ALTER TABLE inventory_mutations
  ADD CONSTRAINT inventory_mutations_source_check
  CHECK (source IN ('shopify', 'marktplaats', 'winkel', 'handmatig', 'moneybird', 'reparatie'));

ALTER TABLE inventory_products
  DROP CONSTRAINT IF EXISTS inventory_products_last_mutation_source_check;

ALTER TABLE inventory_products
  ADD CONSTRAINT inventory_products_last_mutation_source_check
  CHECK (
    last_mutation_source IS NULL
    OR last_mutation_source IN ('shopify', 'marktplaats', 'winkel', 'handmatig', 'moneybird', 'reparatie')
  );
