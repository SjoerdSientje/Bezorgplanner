-- Custom display name for parallel delivery routes (e.g. "Sjoerd", "Malyar").
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_naam text;
