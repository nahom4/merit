# 15 — S3: the federal sweep, deterministic screening, and the fit score

**Status: Built** (S3). Every line reference below is real code. Sources:
[Merit.md §7, §10, appendix](../submission_docs/Merit.md), [roadmap S3](../docs/roadmap.md),
[ADR 0012](../docs/decisions/0012-eligibility-is-a-rule-and-fit-is-a-judgement.md).

**TL;DR:** S3 adds the *other* source of money — posted federal opportunities — and with it the
first model calls in the system. The load-bearing idea is a **cascade**: deterministic rules
reject most announcements at zero model cost, and only survivors reach a model. Screening is not
a performance trick; it is what keeps the fit score defensible and the free tier survivable.

## The big picture

```
 Grants.gov search2 ──► fetchOpportunity ──► opportunities table
   (the list, with        (eligibility,        keyed on the Grants.gov id, so a daily
    the program number)    awards, prose)      sweep rewrites rather than duplicates
                                    │
                              ┌─────┘
                              ▼
                    ╔═════════════════════════╗
                    ║  1. HARD ELIGIBILITY    ║   pure domain, zero model calls
                    ║  applicant type · 501c3 ║   rejects most of the board
                    ║  geography · country    ║   every check stores a readable reason
                    ╚════════════╤════════════╝
                     not ineligible│
                                 ▼
                    ╔═════════════════════════╗
                    ║  2. FIT SCORE 0–100     ║   model call, schema-validated
                    ║  + matched programs     ║   + repair loop, + content-hash cache
                    ║  + explicit gaps        ║   + queued when the quota is spent
                    ╚════════════╤════════════╝
                                 ▼
                         federal board UI + run log
```

Three questions are separated deliberately: **may we apply** (a rule), **is it worth applying**
(a judgement), and **how did organisations like us fare** (S5's arithmetic). Collapsing them
into one model call would produce a number nobody can defend.

## Part 1 — the data source, verified twice

Merit.md's appendix recorded live calls on 7 August 2026. S3 does not re-derive them; it pins
them with a contract test — `tests/contract/grants-gov.contract.test.ts` — which calls the live
API, asserts the fields screening depends on, and **regenerates the fixtures** every other tier
runs against.

| Call | Returns |
|---|---|
| `POST /v1/api/search2` | The list: id, number, title, agency, dates, `oppStatus`, `cfdaList` |
| `POST /v1/api/fetchOpportunity` | Applicant type codes, eligibility prose, award ceiling/floor, expected awards, attachment metadata |

The search hit **does not carry eligibility**, which is why the sweep pays for a second call per
hit ([`opportunity-gateway.port.ts`](../packages/application/src/ports/opportunity-gateway.port.ts)).
`cfdaList` is the join key to USASpending in S5 and survives ingestion into its own indexed
table, `opportunity_programs`.

One field is worth naming: `awardCeiling` arrives as a number on one announcement and the string
`"none"` on the next. [`opportunity-mapper.ts`](../packages/infrastructure/src/grants-gov/opportunity-mapper.ts)
maps `"none"` to null and **fails** on anything else — a figure we cannot read is not a zero.
Dates get the same treatment: `parseGrantsGovDate` handles `08/24/2026` and
`Aug 24, 2026 12:00:00 AM EDT` by hand, because `new Date(string)` is engine- and
timezone-dependent and a deadline that moves by a day would take a year to notice.

## Part 2 — deterministic screening, and its third answer

[`eligibility-screening.ts:241`](../packages/domain/src/opportunity/eligibility-screening.ts)
runs four checks and returns all of them, every one carrying a typed reason code *and* a
sentence a human can read:

| Check | Source | A failure reads |
|---|---|---|
| Applicant type | Grants.gov codes (`applicant-type.ts`) | "This announcement is open to State governments. It does not name nonprofits with 501(c)(3) status." |
| 501(c)(3) status | The BMF's `SUBSECTION` column, via `LibsqlRegistryStatusReader` | "The IRS registry does not record … under 501(c)(3)" |
| Geography | The announcement's own eligibility prose | "This announcement limits eligibility to Alabama, … and Tennessee. Cape Fear Literacy Council is in North Carolina." |
| Country | Same | "This announcement is open only to non-US organisations." |

Three properties matter more than the checks themselves.

**It lives in `packages/domain`.** No database, no network, no clock. That is the tell from
CLAUDE.md §2 — if a rule needs a database to test, it is in the wrong layer.

**"Undecided" is a real answer.** `outcome` is `pass | fail | cannot_determine`, and
[`mayReachAModel`](../packages/domain/src/opportunity/eligibility-screening.ts) at line 268 gates
the model on `!== 'ineligible'` — so an *undecided* announcement is still scored, with the
unresolved check stated on screen. Treating "we could not confirm" as "no" would hide live
opportunities behind confident-looking reasons. Four things produce it: an applicant-type code
Grants.gov added since, an announcement that defers eligibility to its own text field
(code `25`, "Others — see the text field"), a geographic restriction naming no jurisdiction, and
an EIN with no registry row.

**Geography is prose, and the scan is deliberately timid.** Grants.gov has no structured field
for it. [`detectGeographicRestriction`](../packages/domain/src/opportunity/geographic-restriction.ts)
at line 64 requires a place cue — "located in", "within the", "limited to" — followed within 220
characters by a *named* jurisdiction before asserting a restriction, matches longest state names
first so "West Virginia" is never read as "Virginia", and quotes the announcement's own phrase
back in the rejection so the user can check the call. A cue with no jurisdiction is
`indeterminate`. This under-detects on purpose: a wasted score costs one model call, a wrong
rejection costs an opportunity.

The real announcement it is sized for is HRSA-26-045, whose eligibility text reads
*"populations in rural areas within the eight Mississippi Delta Region States (Alabama,
Arkansas, Illinois, Kentucky, Louisiana, Mississippi, Missouri, and Tennessee)"* — 100
characters between the cue and the last name.

## Part 3 — the fit score, and what ships beside it

[`fit-assessment.ts`](../packages/domain/src/opportunity/fit-assessment.ts) is the parse
boundary. A response survives only if it carries an **integer 0–100**, a non-empty rationale,
a `gaps` array, and matched program areas **drawn from a menu**:

```ts
// fit-score.prompt.ts — the menu is the organisation's own program area
// plus the announcement's own funding categories.
const menu = [NteeCode.majorGroupLabel(organization.nteeCode), ...opportunity.fundingCategories];
```

An area outside the menu **fails the parse** rather than being dropped (line 47 onward): a score
justified by an area nobody can check is worse than no score. The rejection message names the
field and the value, which is exactly what the repair loop re-prompts with — see note 16.

`HIGH_FIT_THRESHOLD = 70` is a domain constant with its reasoning attached, and it is a starting
point for the fit-score eval rather than a measured number.

## Part 4 — the cascade, in one place

[`screen-federal-opportunities.use-case.ts`](../packages/application/src/use-cases/screen-federal-opportunities/screen-federal-opportunities.use-case.ts):

- line 115 — `if (!mayReachAModel(screening))` → stored as `not_applicable`, no call made.
- line 136 — a stored score is reused only when the screening *still agrees*: a cached judgement
  about a profile that has since changed is stale, not a saving.
- line 148 — `INTERACTIVE_SCORE_BUDGET = 5` per page load; the rest are `queued`. A click must
  not sit behind forty model calls.

Everything is written back through `saveAssessments`, so the board renders reasons without
re-screening and "why did we not apply to that" has an answer on file.

## Part 5 — the run log

`ReportRunLog` joins the sweep's own counters to `model_calls`, and the board renders them:

> Last sweep read 15 opportunities across 3 searches: 15 new, 0 updated, 0 parse faults.
> Model spend since the last day: 30 calls, of which 0 cache hits, 27,600 tokens, 0 repairs, 0 failures.

Same instinct as the ingestion reconciliation check: the system reports its own health as data
rather than asking to be trusted. Without it, "the sweep ran" and "the sweep ran and silently
degraded on quota exhaustion" look identical.

## How this was verified

1. **Contract test against live Grants.gov** — schema, `cfdaList`, eligibility prose, attachment
   metadata, and the eligibility facet checked against the applicant-type table.
2. **Unit tests for every screening rule and every rejection reason**, with no database in sight.
3. **The cascade proved twice.** Unit: a `NeverCalledModelGateway` that throws if called at all.
   Integration (`tests/integration/federal-sweep.int.test.ts`): the real recorded announcements
   screened, then every ineligible one checked against every prompt the model received.
4. **The repair loop, against a real HTTP server** — malformed answer, re-prompt containing the
   exact validation error, success; malformed twice, an error value and nothing cached.
5. **Dedupe** — the same announcement swept twice is one row, counted as an update.
6. **E2E** — `tests/e2e/s3-federal-board.spec.ts` opens the board, finds PAR-25-003 rejected with
   a readable reason and no score, and a scored row with its matched areas and gaps.

## What S3 must never do

- **No model call before screening.** If any path scores an announcement the organisation cannot
  apply for, the cascade is broken regardless of what the tests say.
- **No opaque fit number.** A score without matched areas and gaps fails the product rule.
- **No unvalidated model output in the database.** Parse, repair once, then fail as a value.
- **No silent quota failure.** On exhaustion, persisted results are served and the work is
  queued. The system gets slower; it does not lie.

## Learn more

- Note [16 — the LLM orchestrator](16-the-llm-orchestrator.md), which S3 built alongside this.
- [ADR 0012](../docs/decisions/0012-eligibility-is-a-rule-and-fit-is-a-judgement.md) — why
  undecided is a third answer rather than a rejection.
- [Grants.gov API guide](https://www.grants.gov/api/api-guide) · [Assistance Listings](https://sam.gov/content/assistance-listings) — what the number in `cfdaList` is.
