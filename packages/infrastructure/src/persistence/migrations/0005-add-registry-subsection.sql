-- The BMF's SUBSECTION column: 3 is 501(c)(3).
--
-- Federal announcements name applicant types, and the commonest one is "Nonprofits having a
-- 501(c)(3) status with the IRS". Screening that check needs the registry's own answer -- the
-- alternative is asking the user to self-declare a status, which is inventing a field.
--
-- Nullable on purpose: a registry row without a subsection, and no registry row at all, are
-- different facts from "not a charity", and screening reports each of them as it finds them.
ALTER TABLE entities ADD COLUMN subsection INTEGER;

CREATE INDEX entities_subsection ON entities (subsection);
