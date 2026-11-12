-- Publieke link naar Moneybird-factuur-PDF (Supabase Storage), voor bezorgde orders.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS link_factuur text;

COMMENT ON COLUMN orders.link_factuur IS
  'Publieke URL van Moneybird-factuur-PDF (opgeslagen bij afronden / backfill).';
