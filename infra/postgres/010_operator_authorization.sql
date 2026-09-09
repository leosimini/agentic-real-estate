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
