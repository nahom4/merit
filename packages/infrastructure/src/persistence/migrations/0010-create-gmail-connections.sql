-- The connected Gmail mailbox and the last sync position we have persisted for it.
--
-- Merit stores one connected mailbox here. The user authorizes their own mailbox and the app
-- keeps the latest Gmail history id, so a sync -- pushed or asked for -- never re-walks
-- history it has already read.
--
-- The watch_* columns are nullable because the Pub/Sub watch is optional: a mailbox can be
-- connected and synced on demand without a topic to push to. Null here means exactly that
-- and nothing else, which is why it is not a zero-length string.

CREATE TABLE gmail_connections (
  account_id             TEXT PRIMARY KEY,
  email_address          TEXT NOT NULL UNIQUE,
  access_token           TEXT NOT NULL,
  refresh_token          TEXT NOT NULL,
  token_type             TEXT NOT NULL,
  scope                  TEXT NOT NULL,
  access_token_expires_at TEXT NOT NULL,
  watch_expiration       TEXT,
  watch_topic_name       TEXT,
  last_synced_history_id TEXT NOT NULL,
  last_synced_at         TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX gmail_connections_email ON gmail_connections (email_address);
