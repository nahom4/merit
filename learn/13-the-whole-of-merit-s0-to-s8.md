# 13 — The whole of Merit, S0 → S8: the map to read before anything else

**TL;DR:** Notes 01–12 explain the half of Merit that exists today (S0–S1) and note 14 covers S2.
This note is the frame around *all* of it: the eight slices, what each one adds, which tables it
touches, where its code lands in the tree, and what is design versus what is running code. Read
this before an agent starts a slice, so you know what it is building and what to ask it.

---

## Status legend, used in every note from here on

| Marker | Meaning |
|---|---|
| **Built** | Code exists, tests pass, `pnpm gate` covers it. Notes cite real line numbers |
| **Designed** | Specified in [Merit.md](../submission_docs/Merit.md) and [docs/roadmap.md](../docs/roadmap.md), no code yet. Notes cite spec sections and describe the *shape* the code must take |

As of this writing: S0, S1, S2 are **Built**. S3–S8 are **Designed**. Notes 15–21 are deliberately
written ahead of the code — that is their job. When a slice lands, its note gets rewritten with
real line numbers and its marker flipped.

---

## The product in one sentence per slice

```
S0  walking skeleton      one trivial feature crosses every layer, proving the architecture
S1  prospect discovery    profile in → ranked funders out, four bars, evidence underneath
S2  funder reachability   click a funder → "should we bother", every claim citing a filing
S3  federal sweep         Grants.gov in → eligibility screen → fit score. First model calls
S4  drafting              rubric out of the announcement PDF → draft → self-critique → revise
S5  positioning           USASpending award history → competitive base rate (never "win %")
S6  scheduled work        three cron jobs → Calendar milestones, Gmail digests
S7  ask the graph         plain-language questions over typed query tools, never raw SQL
S8  learning              accept/reject retunes weights; portfolio shortlist; review queue
```

Two halves, as Merit.md §6 puts it: an **offline pipeline** builds the graph (S1's ingestion and
resolution), an **online agent** reasons over it and acts (S3–S8). Everything before S1 exists to
make S1 possible; everything after S1 is leverage on it.

## The data flow, whole

```
                    ┌── IRS 990 bulk XML ──┐          ┌── Grants.gov ──┐
                    │  IRS BMF registry    │          │  USASpending   │
                    └──────────┬───────────┘          └───────┬────────┘
                        S1 ingest + resolve                S3/S5 sweep
                               │                              │
                        ╔══════▼══════════════════════════════▼══════╗
                        ║        libSQL — the funding graph          ║
                        ║  funders · grant_records · entities ·      ║
                        ║  entity_links · organizations              ║  ← exists today
                        ║  opportunities · rubrics · assessments ·   ║
                        ║  drafts · pursuits · feedback              ║  ← S3–S8 adds these
                        ╚══════╤═══════════════════════════╤═════════╝
                               │                           │
            S1 score-prospects │                           │ S3 screen + fit score
            S2 funder report   │                           │ S4 extract + draft + critique
            S7 typed queries   │                           │ S5 base rate
                               ▼                           ▼
                        ┌──────────────────────────────────────┐
                        │  apps/web — prospect list · funder    │
                        │  report · federal board · draft       │
                        │  studio · ask · planner · review      │
                        └──────────────┬───────────────────────┘
                                       │  S6: Cloud Scheduler → worker → Calendar / Gmail
                                       ▼  S8: accept/reject/edit flows back into weights
```

The loop at the bottom is the point of S8: user decisions become labels that retune S1's scoring
for *that* organisation.

## Where each slice's code lands

The layer rule (note 02) never changes, so you can predict the file list for a slice before an
agent writes it. Every slice puts arithmetic and rules in `domain`, orchestration in
`application`, anything that touches the outside world in `infrastructure`, and screens in
`apps/web`.

| Slice | domain | application | infrastructure | apps |
|---|---|---|---|---|
| S1 | `organization/`, `grant/`, `resolution/`, `funder/funder-signals`, `prospect/` | `ingest-bundle`, `resolve-recipients`, `score-prospects` | `irs/`, `persistence/` | `features/prospect-list` |
| S2 | `funder/funder-reachability`, `ask-calibration`, `affinity-path`, `financial-trend`, `funder-brief` | `report-funder-reachability` | `propublica/`, `libsql-funder.repository` | `features/funder-reachability` |
| S3 | `opportunity/` — eligibility rules, fit score | `sweep-opportunities`, `screen-eligibility`, `score-fit` | `grants-gov/`, `gemini/`, orchestrator | `features/federal-board` |
| S4 | `rubric/` — criteria, point weighting, critique validation | `extract-rubric`, `draft-section`, `critique-draft` | `pdf/` (pdftotext), `gemini/` | `features/draft-studio` |
| S5 | `positioning/` — cohort statistics, base rate | `build-positioning` | `usaspending/` | federal board panel |
| S6 | `pursuit/` — milestone backward planning, health | `plan-milestones`, `watch-deadlines`, `weekly-briefing` | `google/` (Calendar, Gmail) | `apps/worker/src/jobs` |
| S7 | query result shaping | typed query tools | — | `features/ask` |
| S8 | `feedback/` — weight deltas, shortlist ranking | `record-feedback`, `plan-portfolio` | — | `features/planner`, `features/review-queue` |

If an agent puts eligibility rules in `infrastructure/grants-gov/`, or a fit score inside a React
component, the boundary checks will not always catch it (they check *imports*, not *intent*) —
but you now can.

## The data model: what exists, what is coming

Merit.md §15 lists sixteen tables. Seven exist today, in
[`persistence/migrations/`](../packages/infrastructure/src/persistence/migrations/):

`organizations` · `funders` · `grant_records` · `entities` · `entity_links` ·
`ingest_checkpoints` · `eval_runs`

Two of the spec's tables — `funder_signals` and `prospects` — deliberately **do not exist**. They
are computed on demand from the grant rows, because they are cheap arithmetic and a materialised
copy is a cache-invalidation problem nobody asked for. If a future slice needs them persisted
(S8's per-organisation weights might), that is an ADR, not a quiet migration.

Still to come: `opportunities`, `rubrics`, `assessments` (S3–S4) · `drafts` (S4) · `pursuits`
(S6) · `feedback` (S8) · `model_calls` (S3, the orchestrator's spend log).

## The three product rules that shape every remaining slice

These are in [CLAUDE.md](../CLAUDE.md) and they are not stylistic:

1. **Never one opaque score.** S1 shows four bars. S3's fit score must ship with matched program
   areas and gaps beside it. S5 must never print a win probability.
2. **Every claim cites its source.** S2 enforces this structurally (note 14). S4 enforces it on
   *model* output: a critique score without a cited supporting sentence is rejected by the
   validator, not softened.
3. **State coverage, never imply completeness.** Every use case returns a `coverage` block. When
   an agent adds a use case with no coverage in its return type, that is a review comment.

## What to read next

- **To understand what was built:** notes 01–12, then [14](14-the-funder-reachability-report.md).
- **To read ahead of an agent:** the note for the slice it is starting — [15](15-federal-sweep-and-eligibility-screening.md)
  through [21](21-learning-planning-and-the-review-queue.md).
- **To check its work when it says "done":** [22 — how to review a slice](22-how-to-review-a-slice.md).

## Learn more

- [Merit.md](../submission_docs/Merit.md) — §3 what it does, §6 how it works, §9 the agent, §15 data model
- [docs/roadmap.md](../docs/roadmap.md) — the acceptance criteria, slice by slice. The checklist an agent works against
- [docs/decisions/](../docs/decisions/) — eleven ADRs so far; each records a constraint on everything after it
