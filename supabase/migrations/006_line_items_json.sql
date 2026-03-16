-- Sla gestructureerde Shopify line items op (JSON), inclusief properties per product.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS line_items_json text;

COMMENT ON COLUMN orders.line_items_json IS
  'JSON array van Shopify line items: [{name, price, isFiets, properties:[{name,value}]}]. '
  'Fietsen (price > 500) krijgen hun montage-properties mee (exclusief _Personalize).';
