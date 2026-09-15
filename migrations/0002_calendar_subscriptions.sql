CREATE TABLE IF NOT EXISTS calendar_subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
