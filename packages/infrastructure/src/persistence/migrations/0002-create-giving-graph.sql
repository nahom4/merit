-- The giving graph: who funded whom, from the IRS bulk 990 filings.
--
-- Money is integer cents throughout. Amounts are summed and medianed across 1.4M rows,
-- and a REAL column would drift.

CREATE TABLE funders (
  ein             TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  state           TEXT,
  source_forms    TEXT NOT NULL,
  first_tax_year  INTEGER,
  last_tax_year   INTEGER
);

CREATE INDEX funders_state ON funders (state);

CREATE TABLE grant_records (
  -- A content hash of the filing, funder, recipient, amount, and purpose. Re-ingesting a
  -- bundle rewrites the same rows rather than duplicating them, which is what makes a
  -- killed worker safe to restart.
  id                   TEXT PRIMARY KEY,
  irs_object_id        TEXT NOT NULL,
  funder_ein           TEXT NOT NULL,
  tax_year             INTEGER NOT NULL,
  recipient_name       TEXT NOT NULL,
  -- Normalised at write time: peer matching and entity resolution both read this column,
  -- and normalising on every query would make the join unusable at corpus scale.
  recipient_normalized TEXT NOT NULL,
  recipient_city       TEXT,
  recipient_state      TEXT,
  recipient_zip        TEXT,
  purpose              TEXT,
  amount_cents         INTEGER NOT NULL,
  source_form          TEXT NOT NULL,
  -- Schedule I usually states this; 990-PF never does. Withholding it is how entity
  -- resolution is measured.
  stated_recipient_ein TEXT
);

CREATE INDEX grant_records_funder ON grant_records (funder_ein);
CREATE INDEX grant_records_object ON grant_records (irs_object_id);
CREATE INDEX grant_records_recipient ON grant_records (recipient_normalized);
CREATE INDEX grant_records_state_recipient ON grant_records (recipient_state, recipient_normalized);
CREATE INDEX grant_records_stated_ein ON grant_records (stated_recipient_ein);

-- The canonical registry every recipient string is linked against: the IRS Business
-- Master File. Linking against a known target set turns an open-ended clustering problem
-- into record linkage.
CREATE TABLE entities (
  ein             TEXT PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  ntee_code       TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  revenue_cents   INTEGER,
  blocking_key    TEXT
);

CREATE INDEX entities_blocking_key ON entities (blocking_key);
CREATE INDEX entities_state_ntee ON entities (state, ntee_code);
CREATE INDEX entities_normalized ON entities (normalized_name);

CREATE TABLE entity_links (
  grant_record_id       TEXT PRIMARY KEY,
  entity_ein            TEXT,
  score_total           REAL,
  score_token_set       REAL,
  score_string_distance REAL,
  score_address         REAL,
  -- linked | needs_review | rejected. Uncertain matches are routed to a human rather
  -- than guessed at.
  decision              TEXT NOT NULL,
  rejection_reason      TEXT,
  reviewed_by           TEXT,
  reviewed_at           TEXT
);

CREATE INDEX entity_links_entity ON entity_links (entity_ein);
CREATE INDEX entity_links_decision ON entity_links (decision);

-- Written before work starts, not after it succeeds. A process that dies mid-bundle
-- resumes from the last filing it recorded.
CREATE TABLE ingest_checkpoints (
  bundle                  TEXT PRIMARY KEY,
  status                  TEXT NOT NULL,
  filings_seen            INTEGER NOT NULL DEFAULT 0,
  grants_written          INTEGER NOT NULL DEFAULT 0,
  parse_faults            INTEGER NOT NULL DEFAULT 0,
  individuals_cents       INTEGER NOT NULL DEFAULT 0,
  reconciled_filings      INTEGER NOT NULL DEFAULT 0,
  reconciliation_faults   INTEGER NOT NULL DEFAULT 0,
  last_irs_object_id      TEXT,
  updated_at              TEXT NOT NULL
);

-- Every measured claim this project makes, with the commit that produced it.
CREATE TABLE eval_runs (
  id         TEXT PRIMARY KEY,
  metric     TEXT NOT NULL,
  value      REAL NOT NULL,
  dataset    TEXT NOT NULL,
  commit_sha TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX eval_runs_metric ON eval_runs (metric, created_at);
