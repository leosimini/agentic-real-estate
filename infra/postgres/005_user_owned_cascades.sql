ALTER TABLE monitor DROP CONSTRAINT IF EXISTS monitor_user_id_fkey;
ALTER TABLE monitor ADD CONSTRAINT monitor_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;

ALTER TABLE alert DROP CONSTRAINT IF EXISTS alert_user_id_fkey;
ALTER TABLE alert ADD CONSTRAINT alert_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
