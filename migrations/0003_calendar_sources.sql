CREATE TABLE IF NOT EXISTS calendar_sources (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 url TEXT NOT NULL,
 events TEXT NOT NULL DEFAULT '[]',
 last_checked INTEGER NOT NULL DEFAULT 0,
 last_attempt INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 UNIQUE(user_id,url)
);
CREATE INDEX IF NOT EXISTS calendar_sources_due ON calendar_sources(last_attempt);
