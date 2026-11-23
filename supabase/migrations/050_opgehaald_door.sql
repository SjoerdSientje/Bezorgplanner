-- Wie de ophaalrit afrondde (apart van bezorger bij latere terugbreng).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS opgehaald_door text;

-- Backfill: ophaal-afronder stond tot nu in bezorger_naam bij ophaal/wachtkamer.
UPDATE orders
SET opgehaald_door = NULLIF(TRIM(bezorger_naam), '')
WHERE opgehaald_door IS NULL
  AND bezorger_naam IS NOT NULL
  AND TRIM(bezorger_naam) <> ''
  AND (
    opgehaald_at IS NOT NULL
    OR (
      source = 'reparatie'
      AND type = 'reparatie_ophalen'
      AND afgerond_at IS NOT NULL
    )
  );

-- Oude ophaal→bezorgd zonder opgehaald_at: gebruik afgerond_at als ophaalmoment.
UPDATE orders
SET opgehaald_at = afgerond_at
WHERE opgehaald_at IS NULL
  AND source = 'reparatie'
  AND type = 'reparatie_ophalen'
  AND afgerond_at IS NOT NULL;
