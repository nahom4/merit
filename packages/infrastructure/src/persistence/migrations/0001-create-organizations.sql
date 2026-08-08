-- The organisation Merit works on behalf of.
-- Money is stored as integer cents; SQLite has no decimal type and a REAL column would
-- drift under the sums and medians the prospect scoring runs.
CREATE TABLE organizations (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  ein                 TEXT NOT NULL,
  city                TEXT NOT NULL,
  state               TEXT NOT NULL,
  ntee_code           TEXT NOT NULL,
  annual_revenue_cents INTEGER NOT NULL CHECK (annual_revenue_cents >= 0)
);

-- One profile per EIN. Two would split an organisation's funder history across two
-- prospect lists, which the CreateOrganization use case refuses -- this is the backstop.
CREATE UNIQUE INDEX organizations_ein_unique ON organizations (ein);
