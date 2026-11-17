-- Wie de MP/reparatie-order aanmaakte + uitgebreid reparatie-achtergrondverhaal.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS aangemaakt_door text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS achtergrondverhaal text;
