-- Multi-account scope: isolate mutable data per login account.
-- Both accounts receive Shopify rows, but edits remain account-local.

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS owner_email text;

ALTER TABLE planning_slots
ADD COLUMN IF NOT EXISTS owner_email text;

-- Existing rows fallback to info-account to keep data accessible.
UPDATE orders
SET owner_email = 'info@koopjefatbike.nl'
WHERE owner_email IS NULL;

UPDATE planning_slots ps
SET owner_email = o.owner_email
FROM orders o
WHERE ps.order_id = o.id
  AND ps.owner_email IS NULL;

ALTER TABLE orders
ALTER COLUMN owner_email SET NOT NULL;

ALTER TABLE planning_slots
ALTER COLUMN owner_email SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_owner_email ON orders(owner_email);
CREATE INDEX IF NOT EXISTS idx_planning_slots_owner_email ON planning_slots(owner_email);
CREATE INDEX IF NOT EXISTS idx_orders_owner_status ON orders(owner_email, status);

-- Shopify rows should exist once per account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_shopify_owner_order_id
ON orders(owner_email, source, order_id)
WHERE source = 'shopify' AND order_id IS NOT NULL;
