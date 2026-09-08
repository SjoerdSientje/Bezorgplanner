-- Track & trace van inkomende leveringen (bijv. voorraad/onderdelen voor klantorders).

CREATE TABLE IF NOT EXISTS incoming_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  track_trace_url text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'received')),
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incoming_deliveries_owner_status_created
  ON incoming_deliveries (owner_email, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incoming_deliveries_owner_received
  ON incoming_deliveries (owner_email, received_at DESC NULLS LAST);

CREATE TRIGGER incoming_deliveries_updated_at
  BEFORE UPDATE ON incoming_deliveries
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

ALTER TABLE incoming_deliveries ENABLE ROW LEVEL SECURITY;
