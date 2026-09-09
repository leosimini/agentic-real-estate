ALTER TABLE monitor
  ADD COLUMN IF NOT EXISTS lease_until timestamptz;

ALTER TABLE monitor_run
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

ALTER TABLE monitor_match
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_changed_at timestamptz;

DELETE FROM notification_delivery newer
USING notification_delivery older
WHERE newer.alert_id = older.alert_id
  AND newer.channel = older.channel
  AND newer.created_at > older.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_alert_channel_idx
  ON notification_delivery(alert_id, channel);

CREATE INDEX IF NOT EXISTS notification_delivery_pending_idx
  ON notification_delivery(status, created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS monitor_lease_idx
  ON monitor(enabled, lease_until, next_run_at);
