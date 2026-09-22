-- Besteldatum/tijdstip uit Shopify (order.created_at) op pakketjes-wachtrij.
ALTER TABLE pakketjes_orders
  ADD COLUMN IF NOT EXISTS shopify_created_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pakketjes_orders_owner_shopify_created
  ON pakketjes_orders (owner_email, shopify_created_at);
