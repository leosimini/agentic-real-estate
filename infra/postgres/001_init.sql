CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'consumer' CHECK (role IN ('consumer','owner','operator','admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  base_url text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  property_type text,
  operation text NOT NULL CHECK (operation IN ('sale','rent','wanted')),
  bedrooms smallint,
  rooms smallint,
  bathrooms smallint,
  area_total_m2 numeric(10,2),
  area_covered_m2 numeric(10,2),
  floor text,
  currency char(3),
  canonical_price numeric(16,2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','uncertain','inactive','sold','rented')),
  embedding vector,
  embedding_model text,
  embedding_dimensions int,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_geo_idx ON property(latitude, longitude);
CREATE INDEX IF NOT EXISTS property_status_idx ON property(status, operation);

CREATE TABLE IF NOT EXISTS publication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES source(id),
  source_listing_id text,
  source_url text NOT NULL,
  property_id uuid REFERENCES property(id),
  publisher_type text CHECK (publisher_type IN ('owner','operator','aggregated')),
  publisher_name text,
  title text,
  description text,
  currency char(3),
  price numeric(16,2),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  publication_status text NOT NULL DEFAULT 'active' CHECK (publication_status IN ('active','paused','removed','unknown')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  UNIQUE(source_id, source_listing_id)
);

CREATE INDEX IF NOT EXISTS publication_property_idx ON publication(property_id);
CREATE INDEX IF NOT EXISTS publication_status_idx ON publication(publication_status, last_verified_at);

CREATE TABLE IF NOT EXISTS monitor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_user(id),
  name text NOT NULL,
  intent_text text NOT NULL,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  cadence text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('hourly','daily','weekly')),
  timezone text NOT NULL DEFAULT 'UTC',
  instant_exceptional boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS monitor_due_idx ON monitor(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS monitor_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  candidates_count int NOT NULL DEFAULT 0,
  meaningful_changes_count int NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

CREATE TABLE IF NOT EXISTS monitor_match (
  monitor_id uuid REFERENCES monitor(id) ON DELETE CASCADE,
  property_id uuid REFERENCES property(id) ON DELETE CASCADE,
  score numeric(5,2) NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  dismissed boolean NOT NULL DEFAULT false,
  first_matched_at timestamptz NOT NULL DEFAULT now(),
  last_matched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (monitor_id, property_id)
);

CREATE TABLE IF NOT EXISTS property_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS property_event_recent_idx ON property_event(property_id, event_at DESC);

CREATE TABLE IF NOT EXISTS alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_user(id),
  monitor_id uuid REFERENCES monitor(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE TABLE IF NOT EXISTS notification_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES alert(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','email','push','whatsapp')),
  destination text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempt_count int NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

INSERT INTO source (code, name, base_url)
VALUES ('demo', 'Demo source', 'https://example.invalid')
ON CONFLICT (code) DO NOTHING;
