-- Rit-deel binnen één route bij "terug naar depot / herladen" (1, 2, …).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS leg_nummer int;

COMMENT ON COLUMN orders.leg_nummer IS
  'Deel van de rit binnen dezelfde route na terugkeer naar depot (1 = eerste deel, 2 = na herladen, …). NULL of 1 = geen splitsing.';
