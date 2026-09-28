-- Snapshot van Shopify order.note: note-afgeleide planner-velden alleen syncen
-- als de note echt wijzigt (voorkomt terugzetten van handmatige bezorgtijd/datum/opmerking).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shopify_note_snapshot text;
