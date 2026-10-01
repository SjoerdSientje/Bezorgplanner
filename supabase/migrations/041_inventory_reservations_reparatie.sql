-- Reparatie-orders (aan huis met bekende producten) mogen ook reserveren.

ALTER TABLE inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservations_source_check;

ALTER TABLE inventory_reservations
  ADD CONSTRAINT inventory_reservations_source_check
  CHECK (source IN ('shopify', 'marktplaats', 'reparatie'));
