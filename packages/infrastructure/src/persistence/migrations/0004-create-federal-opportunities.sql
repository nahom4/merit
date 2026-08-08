-- S3: the federal sweep, the screening decisions it produces, and the model spend behind them.
--
-- Money is integer cents, as everywhere. Short lists that are only ever displayed are stored as
-- JSON text; the one list that will be joined on -- the federal program number, which links an
-- announcement to every award ever made under it in S5 -- gets its own indexed table.

CREATE TABLE opportunities (
  -- Grants.gov's own opportunity id. Deduplication keys on this, so a daily sweep that
  -- re-reads yesterday's announcements rewrites rows rather than duplicating them.
  id                      TEXT PRIMARY KEY,
  number                  TEXT NOT NULL,
  title                   TEXT NOT NULL,
  agency                  TEXT NOT NULL,
  status                  TEXT NOT NULL,
  open_date               TEXT,
  close_date              TEXT,
  -- Grants.gov applicant eligibility codes, JSON. Screening decides on these.
  applicant_type_codes    TEXT NOT NULL,
  -- The only place geography is ever stated.
  eligibility_text        TEXT,
  summary                 TEXT,
  funding_categories      TEXT NOT NULL,
  award_ceiling_cents     INTEGER,
  award_floor_cents       INTEGER,
  estimated_funding_cents INTEGER,
  expected_award_count    INTEGER,
  -- The full announcement's attachments, where S4 finds the review rubric.
  attachment_ids          TEXT NOT NULL
);

CREATE INDEX opportunities_status_close ON opportunities (status, close_date);

CREATE TABLE opportunity_programs (
  opportunity_id TEXT NOT NULL,
  program_number TEXT NOT NULL,
  program_title  TEXT,
  PRIMARY KEY (opportunity_id, program_number)
);

CREATE INDEX opportunity_programs_number ON opportunity_programs (program_number);

-- One screening decision per (organisation, opportunity). Every rejection carries the readable
-- reason it was rejected for; `fit_state` distinguishes scored from queued from never-scored,
-- because "not scored yet" is a real third state and rendering it as a zero would be a lie.
CREATE TABLE assessments (
  organization_id           TEXT NOT NULL,
  opportunity_id            TEXT NOT NULL,
  screening_outcome         TEXT NOT NULL,
  -- JSON: one object per rule with its outcome, reason code, and readable reason.
  screening_checks          TEXT NOT NULL,
  fit_score                 INTEGER,
  fit_rationale             TEXT,
  fit_matched_program_areas TEXT,
  fit_gaps                  TEXT,
  fit_state                 TEXT NOT NULL,
  fit_state_reason          TEXT,
  assessed_at               TEXT NOT NULL,
  PRIMARY KEY (organization_id, opportunity_id)
);

-- The persisted queue. Work waiting on quota is a row, not an array in memory, so a restart
-- resumes it instead of losing it.
CREATE INDEX assessments_state ON assessments (fit_state);

CREATE TABLE sweep_runs (
  id                      TEXT PRIMARY KEY,
  started_at              TEXT NOT NULL,
  finished_at             TEXT NOT NULL,
  searches_run            INTEGER NOT NULL,
  hits_seen               INTEGER NOT NULL,
  opportunities_inserted  INTEGER NOT NULL,
  opportunities_updated   INTEGER NOT NULL,
  parse_faults            INTEGER NOT NULL
);

CREATE INDEX sweep_runs_finished ON sweep_runs (finished_at);

-- One row per model call, cache hits included. Without these the run log's numbers would be
-- wrong in the flattering direction, and a silently degraded sweep would look like a quiet one.
CREATE TABLE model_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose         TEXT NOT NULL,
  priority        TEXT NOT NULL,
  model           TEXT NOT NULL,
  cache_hit       INTEGER NOT NULL,
  prompt_tokens   INTEGER NOT NULL,
  response_tokens INTEGER NOT NULL,
  latency_ms      INTEGER NOT NULL,
  queue_wait_ms   INTEGER NOT NULL,
  repairs         INTEGER NOT NULL,
  outcome         TEXT NOT NULL,
  occurred_at     TEXT NOT NULL
);

CREATE INDEX model_calls_occurred ON model_calls (occurred_at);

-- Content-hash cache: identical inputs never pay twice. The key covers the prompt, the response
-- contract, and the model id, so a model upgrade or an edited profile is a miss rather than a
-- stale hit.
CREATE TABLE model_response_cache (
  key        TEXT PRIMARY KEY,
  response   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
