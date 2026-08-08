-- External side effects are idempotent only if the fact of sending is durable.

CREATE TABLE scheduled_notifications (
  dedupe_key      TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  opportunity_id  TEXT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  sent_at         TEXT NOT NULL
);

CREATE INDEX scheduled_notifications_org_kind ON scheduled_notifications (organization_id, kind);

CREATE TABLE scheduled_milestones (
  dedupe_key        TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  opportunity_id    TEXT NOT NULL,
  milestone_kind    TEXT NOT NULL,
  label             TEXT NOT NULL,
  due_date          TEXT NOT NULL,
  calendar_event_id TEXT,
  approved_at       TEXT
);

CREATE INDEX scheduled_milestones_org_due ON scheduled_milestones (organization_id, due_date);
