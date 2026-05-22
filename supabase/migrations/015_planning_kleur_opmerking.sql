-- Kleurmarkering per order voor de planning-sheet (groen/oranje/rood).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS planning_kleur text CHECK (planning_kleur IN ('groen', 'oranje', 'rood'));
-- Interne planning-opmerking (verplicht bij oranje markering).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS planning_opmerking text;
