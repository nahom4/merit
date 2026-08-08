-- Indexes for the prospect queries.
--
-- These change no data and no result, only how long the answer takes. They are here because
-- the answer previously did not arrive: a single ScoreProspects call against the 1.06M-record
-- corpus exceeded the eval tier's ten-minute timeout, which meant the S1 benchmark could not
-- be run at all.
--
-- The peer query asks for organisations in one program area, inside a revenue band, that
-- somebody has actually funded. Its plan was a full scan of all 1.98M registry rows, and for
-- every one of them a correlated EXISTS that entered entity_links through the index on
-- `decision` alone -- a column with three values, whose 'linked' entry covers some 700,000
-- rows. Roughly two million walks of a very large index range.

-- Turns that EXISTS into a point lookup. Leading column is the selective one; `decision`
-- rides along so the check never touches the table.
CREATE INDEX entity_links_entity_decision ON entity_links (entity_ein, decision);

-- Lets the peer query seek the program area and scan only the matching revenue range,
-- rather than reading every registry row. Indexed on the expression the query actually
-- uses, so the SQL keeps saying what it means.
CREATE INDEX entities_ntee_group_revenue ON entities (substr(ntee_code, 1, 1), revenue_cents);

-- Funder histories are loaded for up to 400 candidates at a time, keyed on the funder.
-- The existing index on funder_ein alone leaves the join to fetch each row for its year and
-- amount; carrying them in the index keeps the common read off the table.
CREATE INDEX grant_records_funder_year_amount ON grant_records (funder_ein, tax_year, amount_cents);
