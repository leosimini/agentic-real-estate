ALTER TABLE publication_snapshot
  ADD COLUMN IF NOT EXISTS result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
