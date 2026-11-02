-- Serialiseer Moneybird factuurregel-updates per Shopify-order.
-- Voorkomt dubbele regels bij parallelle orders/updated webhooks
-- (PATCH zonder effectieve _destroy voegt regels toe i.p.v. te vervangen).

ALTER TABLE moneybird_shopify_invoice_locks
  ADD COLUMN IF NOT EXISTS update_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS update_lease_token text;
