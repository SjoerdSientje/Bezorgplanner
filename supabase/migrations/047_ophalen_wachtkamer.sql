-- Ophaal-wachtkamer: na rit afronden wacht de fiets op terugbrengen of winkelafhaal.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS opgehaald_at timestamptz,
  ADD COLUMN IF NOT EXISTS gekoppeld_ophalen_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moneybird_estimate_id text,
  ADD COLUMN IF NOT EXISTS moneybird_estimate_number text,
  ADD COLUMN IF NOT EXISTS ophalen_afgehandeld_via text;

-- ophalen_afgehandeld_via: 'terugbrengen' | 'winkelafhaal'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_ophalen_afgehandeld_via_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_ophalen_afgehandeld_via_check
      CHECK (
        ophalen_afgehandeld_via IS NULL
        OR ophalen_afgehandeld_via IN ('terugbrengen', 'winkelafhaal')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_status_opgehaald
  ON orders (owner_email, status)
  WHERE status = 'opgehaald';

CREATE INDEX IF NOT EXISTS idx_orders_gekoppeld_ophalen
  ON orders (gekoppeld_ophalen_order_id)
  WHERE gekoppeld_ophalen_order_id IS NOT NULL;
