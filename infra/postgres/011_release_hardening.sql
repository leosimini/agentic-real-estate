ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;

ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_auth_version_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_auth_version_check CHECK (auth_version > 0);

CREATE TABLE IF NOT EXISTS account_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_token_usable_idx
  ON account_token(token_hash, purpose, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE notification_delivery
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE notification_delivery DROP CONSTRAINT IF EXISTS notification_delivery_status_check;
ALTER TABLE notification_delivery ADD CONSTRAINT notification_delivery_status_check
  CHECK (status IN ('pending','processing','sent','failed','dead','skipped'));
ALTER TABLE notification_delivery DROP CONSTRAINT IF EXISTS notification_delivery_attempts_check;
ALTER TABLE notification_delivery ADD CONSTRAINT notification_delivery_attempts_check
  CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts);

UPDATE notification_delivery
SET next_attempt_at=COALESCE(next_attempt_at, created_at), updated_at=now()
WHERE status IN ('pending','failed');

DROP INDEX IF EXISTS notification_delivery_pending_idx;
CREATE INDEX IF NOT EXISTS notification_delivery_due_idx
  ON notification_delivery(channel, next_attempt_at, created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS notification_delivery_lease_idx
  ON notification_delivery(lease_until)
  WHERE status='processing';
