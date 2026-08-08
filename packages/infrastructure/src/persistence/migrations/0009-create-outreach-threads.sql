-- Outreach tracking, one row per pursuit target.
--
-- Merit does not send the email itself. It stores the draft, the target the user entered, and
-- later Gmail thread/message ids once the mailbox sync is wired up.

CREATE TABLE outreach_threads (
  organization_id   TEXT NOT NULL,
  target_id         TEXT NOT NULL,
  target_kind       TEXT NOT NULL CHECK (target_kind IN ('federal', 'foundation')),
  target_name       TEXT NOT NULL,
  contact_email     TEXT,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'replied', 'follow_up_needed')),
  gmail_message_id  TEXT,
  gmail_thread_id   TEXT,
  last_synced_at    TEXT,
  saved_at          TEXT NOT NULL,

  PRIMARY KEY (organization_id, target_id, target_kind)
);

CREATE INDEX outreach_threads_org_status ON outreach_threads (organization_id, status);
