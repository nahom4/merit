# 19 — S6: three cron jobs, milestones on a calendar, and silence as a feature

**Status: Designed.** Sources: [Merit.md §10](../submission_docs/Merit.md), [roadmap S6](../docs/roadmap.md).

**TL;DR:** S6 is where Merit stops being a website and starts being an agent: it works when nobody
is logged in. Three Cloud Scheduler jobs (the free-tier limit — three, not four), backward-planned
milestones written to Google Calendar after review, and Gmail alerts **only above threshold**. Two
engineering rules carry the slice: every job handler is idempotent, and Calendar and Gmail are the
only dependencies in the whole design that have never been verified.

## The big picture

```
 Cloud Scheduler (exactly 3 jobs — the always-free limit)
 ├─ 06:00 daily    SWEEP        Grants.gov → screen (S3) → fit score → positioning (S5)
 │                              → extract rubrics for high-fit (S4) → alert above threshold
 ├─ 07:00 daily    DEADLINE     milestone health → escalate slipping → at-risk warnings
 └─ Mon 08:00      BRIEFING     forecast vs target · new prospects · decisions needed · at risk
                       │
                       ▼
              apps/worker/src/jobs/*
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Google Calendar   Gmail        libSQL (pursuits, milestones)
   milestones,       alerts,
   reviewed first    thresholded
```

Graph rebuilds — the IRS bundle ingestion from S1 — run as offline workers triggered on new bundle
publication, **outside** the three-job budget. That is not a loophole; it is a different trigger.

## Part 1 — three jobs is a constraint, not a target

The free tier allows three Cloud Scheduler jobs. The roadmap wording is deliberately blunt:
*"Exactly three Cloud Scheduler jobs"*, and CLAUDE.md's agent instructions repeat it: *"Three Cloud
Scheduler jobs, not four."*

Watch for the two ways an agent quietly breaks this: adding a fourth job "just for cleanup", or
adding an external uptime pinger that is a scheduler under another name. If a fourth kind of work
genuinely needs doing, it goes *inside* one of the three handlers, and the handler's log says it
ran. That is a design constraint doing its job — it forces the daily sweep to be one coherent
pipeline rather than five loosely-related crons.

## Part 2 — idempotency, because delivery is at-least-once

> Job handlers idempotent; a duplicate scheduler delivery sends nothing twice.

Cloud Scheduler, like every scheduler, can deliver twice: a retry after a timeout, a redeploy, a
manual re-run during debugging. The system already knows how to handle this — S1's ingestion is
keyed on IRS object id so reprocessing is a no-op (note 07). S6 needs the same property, but the
side effects are now *external and visible*: a duplicate delivery must not create a second calendar
event or send a second email.

The mechanism is a natural key per action — `(pursuit_id, milestone_kind, target_date)` for a
calendar event, `(org_id, opportunity_id, alert_kind)` for an alert — recorded before or with the
send, and checked first. Storing Calendar's returned `calendar_event_ids[]` on the pursuit (it is
in Merit.md §15's schema for exactly this reason) also lets an update *move* an event rather than
create a duplicate one.

Note the asymmetry with everything before it: a bug in prospect scoring produces a wrong number on
a screen. A bug here sends a real email to a real executive director, twice. Actions on the outside
world deserve a higher bar, and this is the slice where "no shortcuts" costs something.

## Part 3 — silence is a feature

> **Alerts only above threshold — silence is a feature**

An agent that emails about every opportunity it found is worse than no agent, because it moves the
filtering work back onto the person who has no time. The threshold is configurable, it is a
product-level number with reasoning attached, and the default should err toward quiet.

This is also why the weekly briefing has a fixed structure — forecast against target, new prospects
from the graph, decisions needed this week, what is at risk. Four questions, answered whether or
not anything happened. A briefing is the scheduled thing; alerts are the exceptional thing.

## Part 4 — milestones are backward-planned, and reviewed before commit

> Backward-planned milestones written to Google Calendar, **reviewed before commit**

Backward planning: from the submission deadline, work backwards — draft complete, board sign-off,
letters of support requested, budget finalised — so the dates a user sees are derived from a real
constraint rather than invented. That derivation is pure arithmetic over a deadline and a template,
so it belongs in `domain/pursuit/`, is unit-testable, and needs an injected clock (CLAUDE.md: no
hidden clocks).

"Reviewed before commit" is the human-control rule from Merit.md §10's action table. Merit proposes
the milestones; a human accepts them; only then does anything reach Calendar. An agent that writes
straight to the calendar has broken the product rule even if the dates are right.

## Part 5 — the only unverified dependencies in the design

Merit.md's appendix ends with an unusually honest paragraph:

> Google Calendar and Gmail are standard OAuth integrations requiring no billing account. They are
> assumed rather than tested, and are the only unverified dependencies in this design.

Which is why the roadmap requires *"contract tests for Calendar and Gmail (the only unverified
dependencies in the design)"*. Everything else in the system was probed live before it was designed
against — the Grants.gov PDF endpoint check is the case study for why (note 15). S6 is where that
debt comes due, and the first task of the slice is verification: OAuth without a billing account,
scopes needed, quota limits, what a sandbox send looks like.

Expect surprises there, and expect them *before* the job handlers are written, not after.

## How to verify an agent's S6 work

1. **Count the scheduler jobs.** Three. In configuration, not in a comment.
2. **A duplicate-delivery test per handler**: invoke twice with the same payload, assert one
   calendar event and one email. Against a real (test) database, not with a mocked repository.
3. **A threshold test**: a below-threshold opportunity produces *no* send. Assert the gateway was
   not called.
4. **Backward-planning unit tests with an injected clock**, including a deadline too close for the
   full template — the interesting case, and the one that reveals whether milestones are clamped or
   silently placed in the past.
5. **Contract tests for Calendar and Gmail**, per the roadmap. If an agent reports S6 done with
   these mocked, it is not done — CLAUDE.md's tier table has no exception for OAuth.
6. **A test that milestones are proposed, not committed**, until a human accepts.
7. **Run the weekly briefing against a database with nothing new** and read the output. If it
   invents activity to fill four sections, that is the bug.

## Open questions to expect

- **OAuth token storage and refresh** for a long-lived background job. This is the first place
  Merit holds a user credential, and it deserves an ADR.
- **Timezones.** Deadlines are dates; calendar events are instants. Getting this wrong puts a
  milestone a day off, which for a submission deadline is the whole game.
- **Failure of an external send mid-job.** Half a briefing sent is worse than none; the handler
  needs to know what it already delivered — which is the idempotency key again.

## Learn more

- [Merit.md §10 — Scheduled work and actions](../submission_docs/Merit.md)
- [Cloud Scheduler free tier](https://cloud.google.com/scheduler/pricing) — three jobs per billing account
- [Google Calendar API — events.insert](https://developers.google.com/calendar/api/v3/reference/events/insert) · [Gmail API — messages.send](https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send)
- [Idempotency in message delivery](https://cloud.google.com/pubsub/docs/exactly-once-delivery) — why at-least-once is the assumption to design against
