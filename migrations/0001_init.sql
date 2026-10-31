CREATE TABLE IF NOT EXISTS subscriptions (
  device_id TEXT PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  time_masuk TEXT NOT NULL DEFAULT '07:00',
  time_pulang TEXT NOT NULL DEFAULT '15:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  masuk_checked_date TEXT,
  pulang_checked_date TEXT,
  last_sent_masuk TEXT,
  last_sent_pulang TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_timezone ON subscriptions(timezone);
