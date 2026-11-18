-- Checklist meegenomen sleutels/NFC bij ophaalrit (alleen items met "Ja").

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ophalen_meegenomen_json jsonb;
