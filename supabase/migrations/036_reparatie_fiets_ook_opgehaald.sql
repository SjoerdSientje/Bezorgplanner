-- Terugbrengen: fiets ook opgehaald → voorrijkosten ×2 (ophalen + terugbrengen).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fiets_ook_opgehaald boolean NOT NULL DEFAULT false;
