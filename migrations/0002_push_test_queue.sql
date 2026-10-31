CREATE TABLE IF NOT EXISTS push_test_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_test_queue_run_at ON push_test_queue(run_at);
