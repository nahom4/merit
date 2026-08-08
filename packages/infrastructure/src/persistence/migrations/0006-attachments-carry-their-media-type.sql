-- S4 has to choose which announcement file to read.
--
-- `attachment_ids` stored a JSON array of ids and nothing else, which is enough to download a
-- file and not enough to decide whether downloading it is worth doing. A "Full Announcement"
-- folder routinely holds the NOFO beside a budget spreadsheet and a webinar flyer; handing
-- `pdftotext` the spreadsheet produces silence rather than a rubric, and silence is the failure
-- mode this codebase refuses.
--
-- The column now holds a JSON array of objects -- `{ id, fileName, mimeType }`. Renamed rather
-- than added beside the old one, because two columns describing the same fact is how they drift.
ALTER TABLE opportunities RENAME COLUMN attachment_ids TO attachments;

-- Rows written before the rename hold `["344872"]`, which the new row schema rejects -- and
-- rejecting them is right, but failing every board load until the next sweep is not. The ids
-- are carried across with the two new fields empty, which is exactly what is known about them:
-- the media type was never stored, and the next sweep overwrites the row with the real values.
UPDATE opportunities
SET attachments = (
  SELECT json_group_array(json_object('id', value, 'fileName', '', 'mimeType', ''))
  FROM json_each(opportunities.attachments)
)
WHERE json_valid(attachments)
  AND json_array_length(attachments) > 0
  AND json_type(attachments, '$[0]') = 'text';
