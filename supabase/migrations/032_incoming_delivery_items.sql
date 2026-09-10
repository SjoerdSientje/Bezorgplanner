-- Inkomende leveringen: regels, bijlage, verwachte levertijd, annuleren.

ALTER TABLE incoming_deliveries
  RENAME COLUMN note TO expected_delivery;

ALTER TABLE incoming_deliveries
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

ALTER TABLE incoming_deliveries
  DROP CONSTRAINT IF EXISTS incoming_deliveries_status_check;

ALTER TABLE incoming_deliveries
  ADD CONSTRAINT incoming_deliveries_status_check
  CHECK (status IN ('pending', 'received', 'cancelled'));

CREATE TABLE IF NOT EXISTS incoming_delivery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES incoming_deliveries(id) ON DELETE CASCADE,
  owner_email text NOT NULL,
  product_id uuid REFERENCES inventory_products(id) ON DELETE SET NULL,
  product_title text,
  quantity integer NOT NULL CHECK (quantity > 0),
  is_free_text boolean NOT NULL DEFAULT false,
  free_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incoming_delivery_items_line_check CHECK (
    (is_free_text = false AND product_id IS NOT NULL)
    OR (is_free_text = true AND free_text IS NOT NULL AND length(trim(free_text)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_incoming_delivery_items_delivery
  ON incoming_delivery_items (delivery_id);

CREATE INDEX IF NOT EXISTS idx_incoming_delivery_items_product
  ON incoming_delivery_items (owner_email, product_id)
  WHERE product_id IS NOT NULL;

ALTER TABLE incoming_delivery_items ENABLE ROW LEVEL SECURITY;

-- Bijlagen (PDF/afbeeldingen/docs) via service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('incoming-deliveries', 'incoming-deliveries', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read incoming-deliveries" ON storage.objects;
CREATE POLICY "Public read incoming-deliveries"
ON storage.objects FOR SELECT
USING (bucket_id = 'incoming-deliveries');

DROP POLICY IF EXISTS "Service upload incoming-deliveries" ON storage.objects;
CREATE POLICY "Service upload incoming-deliveries"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'incoming-deliveries');
