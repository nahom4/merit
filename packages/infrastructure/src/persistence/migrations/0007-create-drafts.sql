-- S4: the draft, what it was written against, and what judged it.
--
-- One row per (organisation, target). Re-drafting replaces it rather than accumulating versions:
-- a draft is a working document the human takes over, not an audit trail, and keeping every
-- generation would grow without bound for a history nobody reads.
--
-- The critique is stored twice. `critique_before` is the score of the text as first written,
-- `critique_after` the score after revision. Both, because a per-criterion score with nothing to
-- compare it against is a number the user has to take on faith -- and the pair is what makes the
-- revision pass falsifiable. If the second score is not better than the first, revision did not
-- work, and the studio says so rather than hiding it.

CREATE TABLE drafts (
  organization_id       TEXT NOT NULL,
  -- The Grants.gov opportunity id, or the funder EIN for a foundation draft.
  target_id             TEXT NOT NULL,
  target_kind           TEXT NOT NULL CHECK (target_kind IN ('federal', 'foundation')),

  -- The extracted rubric as JSON, or NULL when none could be read. Nullable on purpose: "no
  -- rubric" and "a rubric with no criteria" are different facts, and only one of them is a bug.
  rubric                TEXT,

  -- What the drafting was conditioned on: 'rubric' or 'summary', with the confidence and the
  -- sentence shown to the user. Never derived at read time -- a draft written last week under a
  -- since-changed threshold must still report the basis it was actually written on.
  conditioning_kind     TEXT NOT NULL CHECK (conditioning_kind IN ('rubric', 'summary')),
  conditioning_note     TEXT NOT NULL,
  conditioning_confidence REAL NOT NULL,

  -- JSON array of { criterionId, heading, text, subCriteria }.
  sections              TEXT NOT NULL,

  critique_before       TEXT,
  critique_after        TEXT,
  -- JSON array of criterion ids, in the order revision actually spent calls on them.
  revised_criterion_ids TEXT NOT NULL,

  -- Non-null means the draft is partial: the quota ran out, or a document could not be read.
  -- Served with its note rather than suppressed -- half a draft and an explanation beats a
  -- spinner, and the model calls already spent are not thrown away.
  note                  TEXT,

  drafted_at            TEXT NOT NULL,

  PRIMARY KEY (organization_id, target_id)
);

CREATE INDEX drafts_drafted_at ON drafts (drafted_at);
