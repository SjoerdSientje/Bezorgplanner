-- status 'opgehaald' toestaan (ophalen-wachtkamer).
-- Zonder dit faalt afronden van ophaalorders op de CHECK uit 001_sheets.sql.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (
    status IN (
      'ritjes_vandaag',
      'gepland',
      'bezorgd',
      'mp_orders',
      'opgehaald'
    )
  );
