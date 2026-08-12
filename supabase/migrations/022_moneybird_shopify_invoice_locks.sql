-- Voorkom dubbele Moneybird-facturen bij parallelle Shopify-webhooks (orders/create + orders/updated).

CREATE TABLE IF NOT EXISTS moneybird_shopify_invoice_locks (
  shopify_order_id text PRIMARY KEY,
  moneybird_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE moneybird_shopify_invoice_locks ENABLE ROW LEVEL SECURITY;
