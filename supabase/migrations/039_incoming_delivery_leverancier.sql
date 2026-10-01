-- Leverancier bij inkomende leveringen (zoekbaar in de UI).

ALTER TABLE incoming_deliveries
  ADD COLUMN IF NOT EXISTS leverancier text;
