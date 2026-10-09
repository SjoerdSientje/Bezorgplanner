-- MP-orders zonder garantie: geen aankoopbewijs/garantiebewijs naar de klant.
-- Voorraadreservering/-aftrek blijft ongewijzigd.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS geen_garantie boolean NOT NULL DEFAULT false;
