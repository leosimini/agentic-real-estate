CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE publication
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN source_listing_id SET NOT NULL,
  ALTER COLUMN property_id SET NOT NULL;

ALTER TABLE property
  ADD COLUMN IF NOT EXISTS normalized_address text,
  ADD COLUMN IF NOT EXISTS address_unit text;

CREATE INDEX IF NOT EXISTS property_normalized_address_idx
  ON property USING gin (normalized_address gin_trgm_ops);

CREATE TABLE IF NOT EXISTS publication_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source(id),
  source_listing_id text NOT NULL,
  direct_url text NOT NULL,
  fetched_at timestamptz NOT NULL,
  source_status text NOT NULL CHECK (source_status IN ('active','paused','removed','unknown')),
  status_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_listing_id, fetched_at, content_hash)
);

CREATE INDEX IF NOT EXISTS publication_snapshot_identity_idx
  ON publication_snapshot(source_id, source_listing_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS canonical_match_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES publication_snapshot(id) ON DELETE CASCADE,
  candidate_property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('confirmed','likely','potential')),
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by text NOT NULL CHECK (decided_by IN ('deterministic','ai','human')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id, candidate_property_id)
);

CREATE TABLE IF NOT EXISTS duplicate_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_decision_id uuid NOT NULL UNIQUE REFERENCES canonical_match_decision(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publication_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
  snapshot_id uuid REFERENCES publication_snapshot(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS publication_event_recent_idx
  ON publication_event(publication_id, event_at DESC);

ALTER TABLE monitor_run ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS monitor_run_idempotency_idx
  ON monitor_run(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE alert ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS alert_idempotency_idx
  ON alert(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE notification_delivery ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_idempotency_idx
  ON notification_delivery(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES app_user(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_event_resource_idx
  ON audit_event(resource_type, resource_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS property_set_updated_at ON property;
CREATE TRIGGER property_set_updated_at
BEFORE UPDATE ON property
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
