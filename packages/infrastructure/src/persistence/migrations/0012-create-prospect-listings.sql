-- The computed prospect list for an organisation, kept so the screen does not recompute it.
--
-- Scoring one organisation reads the full grant history of 400 candidate funders -- around
-- 290,000 rows -- because the signals are computed per funder over every grant it ever made.
-- That is seven seconds a page load, and the answer does not change between two loads: the
-- profile is the same and the corpus only changes when a bundle is ingested.
--
-- The payload is the listing as JSON, parsed by a schema on the way back in. computed_at is
-- shown on the screen, so the user knows how old the answer is rather than assuming it is live.

CREATE TABLE prospect_listings (
  organization_id TEXT PRIMARY KEY,
  payload         TEXT NOT NULL,
  computed_at     TEXT NOT NULL
);
