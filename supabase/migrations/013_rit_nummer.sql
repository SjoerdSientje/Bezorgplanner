-- Rit-nummer per order: bij kleine bus met meerdere trips krijgt elke order
-- het nummer van de rit (1, 2, 3 …) zodat de ritjes-vandaag tabel gekleurd
-- kan worden. NULL = geen rit berekend of grote bus gebruikt.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rit_nummer int;
