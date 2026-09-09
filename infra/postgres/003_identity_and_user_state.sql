CREATE TABLE IF NOT EXISTS user_credential (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  algorithm text NOT NULL DEFAULT 'scrypt-v1',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS migration_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_version text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text NOT NULL,
  payload jsonb NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO migration_quarantine (migration_version, entity_type, entity_id, reason, payload)
SELECT '003_identity_and_user_state.sql', 'monitor', id::text,
  'Legacy monitor has no owning user', to_jsonb(monitor)
FROM monitor WHERE user_id IS NULL;

DELETE FROM monitor WHERE user_id IS NULL;

ALTER TABLE monitor ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE publication
  ADD COLUMN IF NOT EXISTS publisher_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT;

INSERT INTO migration_quarantine (migration_version, entity_type, entity_id, reason, payload)
SELECT '003_identity_and_user_state.sql', 'publication', id::text,
  'Legacy publication ownership was absent or inconsistent', to_jsonb(publication)
FROM publication
WHERE publisher_type IS NULL
   OR (publisher_type IN ('owner','operator') AND publisher_user_id IS NULL)
   OR (publisher_type = 'aggregated' AND publisher_user_id IS NOT NULL);

UPDATE publication
SET publisher_type = 'aggregated', publisher_user_id = NULL
WHERE publisher_type IS NULL
   OR (publisher_type IN ('owner','operator') AND publisher_user_id IS NULL)
   OR (publisher_type = 'aggregated' AND publisher_user_id IS NOT NULL);

ALTER TABLE publication ALTER COLUMN publisher_type SET NOT NULL;

ALTER TABLE publication DROP CONSTRAINT IF EXISTS publication_publisher_owner_check;
ALTER TABLE publication ADD CONSTRAINT publication_publisher_owner_check CHECK (
  (publisher_type = 'aggregated' AND publisher_user_id IS NULL)
  OR (publisher_type IN ('owner','operator') AND publisher_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS publication_publisher_user_idx
  ON publication(publisher_user_id, publication_status);

CREATE TABLE IF NOT EXISTS saved_collection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, name),
  UNIQUE(id, user_id)
);

CREATE TABLE IF NOT EXISTS saved_property (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  collection_id uuid,
  note text,
  visit_status text NOT NULL DEFAULT 'not_planned' CHECK (
    visit_status IN ('not_planned','planned','visited','rejected','shortlisted')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, property_id),
  FOREIGN KEY(collection_id, user_id) REFERENCES saved_collection(id, user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS property_dismissal (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN (
    'price','location','condition','layout','floor','noise','expenses','unavailable','other'
  )),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, property_id)
);

CREATE TABLE IF NOT EXISTS operator_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  legal_name text,
  license_number text,
  website_url text,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (
    verification_status IN ('pending','verified','rejected','suspended')
  ),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
  operator_profile_id uuid NOT NULL REFERENCES operator_profile(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(publication_id, operator_profile_id)
);

CREATE TABLE IF NOT EXISTS inquiry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  publication_id uuid REFERENCES publication(id) ON DELETE SET NULL,
  sender_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_preference (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT false,
  digest_enabled boolean NOT NULL DEFAULT true,
  quiet_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO source (code, name)
VALUES ('manual', 'Direct publication')
ON CONFLICT (code) DO NOTHING;
