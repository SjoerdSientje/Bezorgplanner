-- Al betaald / te betalen i.p.v. alleen boolean betaald.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS al_betaald numeric(10, 2),
  ADD COLUMN IF NOT EXISTS te_betalen numeric(10, 2),
  ADD COLUMN IF NOT EXISTS shopify_line_snapshot jsonb;

COMMENT ON COLUMN orders.al_betaald IS 'Bedrag dat al betaald is (Shopify outstanding-aftrek, of 0 bij MP/reparatie tot afronden).';
COMMENT ON COLUMN orders.te_betalen IS 'Nog openstaand bedrag aan de deur / openstaand Shopify-saldo.';
COMMENT ON COLUMN orders.shopify_line_snapshot IS 'Snapshot van Shopify line items (id/qty/name/price) voor edit-diff / Moneybird credit.';

-- Backfill: bestaand boolean-gedrag behouden waar mogelijk.
UPDATE orders
SET
  al_betaald = CASE
    WHEN betaald IS TRUE THEN COALESCE(bestelling_totaal_prijs, 0)
    ELSE 0
  END,
  te_betalen = CASE
    WHEN betaald IS TRUE THEN 0
    ELSE COALESCE(bestelling_totaal_prijs, 0)
  END
WHERE al_betaald IS NULL OR te_betalen IS NULL;
