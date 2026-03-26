-- Maak productregels account-specifiek i.p.v. globaal.
ALTER TABLE public.product_default_items_rules
  ADD COLUMN IF NOT EXISTS owner_email text;

UPDATE public.product_default_items_rules
SET owner_email = COALESCE(owner_email, 'legacy')
WHERE owner_email IS NULL;

ALTER TABLE public.product_default_items_rules
  ALTER COLUMN owner_email SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'product_default_items_rules'
      AND constraint_name = 'product_default_items_rules_pkey'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.product_default_items_rules
      DROP CONSTRAINT product_default_items_rules_pkey;
  END IF;
END $$;

ALTER TABLE public.product_default_items_rules
  ADD CONSTRAINT product_default_items_rules_pkey PRIMARY KEY (owner_email, id);
