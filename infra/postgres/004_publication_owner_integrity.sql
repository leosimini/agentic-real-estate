ALTER TABLE publication DROP CONSTRAINT IF EXISTS publication_publisher_user_id_fkey;
ALTER TABLE publication ADD CONSTRAINT publication_publisher_user_id_fkey
  FOREIGN KEY (publisher_user_id) REFERENCES app_user(id) ON DELETE RESTRICT;
