-- When the two follow-up reminders for a pursuit were written to the calendar.
--
-- Null means they have not been written. It is the idempotency guard: a sync that sees the same
-- sent message twice must not put a second pair of reminders on somebody's calendar.

ALTER TABLE outreach_threads ADD COLUMN follow_ups_scheduled_at TEXT;
