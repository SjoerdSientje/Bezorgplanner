-- RPC functie die alle orders teruggeeft, buiten PostgREST row-limit om
CREATE OR REPLACE FUNCTION get_all_orders()
RETURNS SETOF orders
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT * FROM orders ORDER BY created_at DESC;
$$;
