CREATE UNIQUE INDEX IF NOT EXISTS listing_claim_one_approved_per_publication_idx
  ON listing_claim(publication_id) WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS operator_membership (
  operator_profile_id uuid NOT NULL REFERENCES operator_profile(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','manager','agent','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operator_profile_id, user_id)
);

INSERT INTO operator_membership (operator_profile_id, user_id, role)
SELECT id, user_id, 'owner' FROM operator_profile
ON CONFLICT (operator_profile_id, user_id) DO NOTHING;

ALTER TABLE publication
  ADD COLUMN IF NOT EXISTS publisher_operator_profile_id uuid REFERENCES operator_profile(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS declared_availability text NOT NULL DEFAULT 'available' CHECK (
    declared_availability IN ('available','reserved','sold','rented','unavailable','unknown')
  ),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE publication pub SET publisher_operator_profile_id=profile.id
FROM operator_profile profile
WHERE pub.publisher_type='operator' AND pub.publisher_user_id=profile.user_id
  AND pub.publisher_operator_profile_id IS NULL;

UPDATE publication
SET publisher_type='owner'
WHERE publisher_type='operator' AND publisher_operator_profile_id IS NULL;

ALTER TABLE publication DROP CONSTRAINT IF EXISTS publication_publisher_owner_check;
ALTER TABLE publication ADD CONSTRAINT publication_publisher_owner_check CHECK (
  (publisher_type = 'aggregated' AND publisher_user_id IS NULL AND publisher_operator_profile_id IS NULL)
  OR (publisher_type = 'owner' AND publisher_user_id IS NOT NULL AND publisher_operator_profile_id IS NULL)
  OR (publisher_type = 'operator' AND publisher_user_id IS NOT NULL AND publisher_operator_profile_id IS NOT NULL)
);

ALTER TABLE listing_claim
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS operator_publication_id uuid REFERENCES publication(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS listing_claim_operator_recent_idx
  ON listing_claim(operator_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inquiry_recipient_recent_idx
  ON inquiry(recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inquiry_sender_recent_idx
  ON inquiry(sender_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operator_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_profile_id uuid NOT NULL REFERENCES operator_profile(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv','json','xml','api')),
  filename text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  error_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(operator_profile_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS operator_import_recent_idx
  ON operator_import(operator_profile_id, created_at DESC);
