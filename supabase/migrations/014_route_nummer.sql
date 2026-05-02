-- Welke parallelle route (voertuig) uit Routific: 1, 2, … — NULL = één bus / geen splitsing.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_nummer int;
