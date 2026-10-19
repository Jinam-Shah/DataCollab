-- Phase 2: background ingestion status and the upload quality report.
ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS processed_rows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS quality_report JSONB;
ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS ingest_ms INTEGER;
ALTER TABLE csv_files ALTER COLUMN file_size TYPE BIGINT;
ALTER TABLE csv_files DROP CONSTRAINT IF EXISTS csv_files_status_check;
ALTER TABLE csv_files ADD CONSTRAINT csv_files_status_check
  CHECK (status IN ('queued', 'processing', 'ready', 'failed'));
