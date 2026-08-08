# Roadmap — vertical slices

One slice at a time, each working end to end before the next begins.

A slice is **not** done because the backend works. It is done when a real user can do the
thing on a real screen against real data, with tests at every tier proving it.

**Current slice: S4.** S0, S1, S2 and S3 are complete.

---

## Slice order, and why

The order follows value, not dependency convenience. S1 is the product's central claim —
*here are foundations that would fund you, and none of them posted anything anywhere.*
Everything before it exists to make S1 possible; everything after it is leverage on S1.

| Slice | Delivers | Status |
|---|---|---|
| **S0** | Walking skeleton — the architecture and test harness, proven | ☑ |
| **S1** | **Prospect discovery** — profile in, ranked funders with evidence out | ☑ |
| **S2** | Funder reachability report — "should we bother" | ☑ |
| **S3** | Federal sweep, eligibility screening, fit scoring | ☑ |
| **S4** | Rubric extraction, drafting, self-critique | ☐ |
| **S5** | Competitive positioning from award history | ☐ |
| **S6** | Scheduled jobs, Calendar milestones, Gmail digests | ☐ |
| **S7** | Ask the graph — conversational query | ☐ |
| **S8** | Feedback learning, portfolio planner, review queue | ☐ |

---

## S0 — Walking skeleton

**Goal:** one trivial feature travels every layer, so the architecture and all five test tiers
are proven before real logic is written. Do not skip this. Everything after copies its shape.

Feature: create an organisation profile, then read it back on a screen.

- [x] pnpm workspace, four packages, two apps, TypeScript strict everywhere
- [x] `dependency-cruiser` + ESLint boundaries fail the build on an inward-pointing violation — **with a deliberately broken commit proving they fail**
- [x] Vitest configured for unit and integration; Playwright for E2E
- [x] libSQL migrations run; `freshDatabase()` helper creates and tears down a real database per test file
- [x] `Result`, branded types, `DomainError` in `packages/shared`
- [x] `Organization` domain type with a parse function and 100% unit coverage
- [x] `CreateOrganization` + `GetOrganization` use cases, fakes in unit tests, real DB in integration
- [x] `LibsqlOrganizationRepository` with an integration test
- [x] Next.js route renders the profile; view-model unit-tested
- [x] E2E: create a profile in the UI, reload, see it
- [x] `pnpm gate` runs types, lint, boundaries, unit, integration in one command
- [x] CI runs `pnpm gate` on every PR; nightly job runs contract + eval
- [x] `.env.example` complete; config parsed by one Zod schema at boot

**Done when:** a new contributor clones, runs `pnpm gate`, and it is green in under five minutes.

---

## S1 — Prospect discovery

**Goal:** a real nonprofit profile produces a ranked list of credible funders, each with four
separate score components and inspectable grantee evidence. This is the product.

The validated benchmark: Cape Fear Literacy Council ($656k revenue) must surface **at least 15
credible funders**, where credible means two or more peer grantees or one in-region grantee,
median grant above the materiality floor. This bar was already cleared on 17% of one year's data
(see `validation/RESULTS.txt`), so it is a floor, not a hope.

**Ingestion**
- [x] Bundle downloader — streaming, resumable, survives a dropped connection mid-transfer
- [x] Filing stream parser, bounded memory, dispatching on return type
- [x] 990-PF Part XV extractor
- [x] 990 Schedule I extractor — **both tables, this is not optional**
- [x] Idempotent upsert keyed on IRS object ID; re-ingest is a no-op (integration-tested)
- [x] Checkpointing; a killed worker resumes with no loss and no duplication (integration-tested)
- [x] Reconciliation self-check against the stated total; parse-fault rate recorded per schema version
- [x] Unknown schema version raises rather than silently dropping fields

**Entity resolution**
- [x] BMF loader — the canonical registry
- [x] Normalisation: case, punctuation, legal suffixes, abbreviation dictionary, applied identically both sides
- [x] Blocking on state + phonetic key
- [x] Scoring: token-set similarity, string distance, address agreement
- [x] Three-way decision: link / reject / route to review
- [x] **Labelled set built by withholding Schedule I EINs**
- [x] Thresholds fitted against the real curve, not chosen by feel — `pnpm eval:fit`, curve committed
- [x] Precision and recall reported as numbers in `eval_runs`, with a committed threshold

**Signals and scoring**
- [x] Turnover, new-grantee rate, HHI, first-time ask distribution, geographic radius, program affinity, retention
- [x] Peer set from program area, revenue band, and region
- [x] Candidate funders = every funder of every peer
- [x] Four score components computed separately; composite is a transparent weighted sum
- [x] Materiality floor applied (0.5% of revenue, $2,500 minimum)

**UI**
- [x] Prospect list: four bars per funder, never one number
- [x] Underlying grantee rows expandable from any score
- [x] Coverage stated in-product: "N comparable organisations found"
- [x] Empty and low-coverage states explain themselves
- [x] Responsive

**Evaluation**
- [x] Held-out funder recovery harness running, threshold committed — 32.1% mean recall@50 over 12 organisations

**Done when:** the Cape Fear benchmark passes in an automated test, and a human can open the
screen, see the ranked funders, and click through to the filings behind any score.

**Result on the 2025 corpus** (1,059,307 grant records, 1,983,563 registry entities,
748,844 links): Cape Fear surfaces **335 credible, material funders** against a floor of 15,
every one of them regional. `pnpm eval` runs in about a minute.

---

## S2 — Funder reachability report

**Goal:** a funder on the prospect list opens into a report that answers the next question a
development director asks — *should we bother* — from the same filings, with every claim
traceable and every gap in the evidence stated.

- [x] Grantee list by year, turnover over time, ask distribution, geographic spread, program mix
- [x] Ask-size calibration: recommended amount from first-time grants, filtered to the org's size band
- [x] Affinity paths — shared-funder proximity, labelled as exactly that, never as a personal connection
- [x] ProPublica financial trend and capacity
- [x] Funder brief with a citation on every claim, and an explicit statement of what the evidence does not support

**Done when:** a user clicks a funder on the prospect list and gets a report whose every claim
names the filing behind it — verified by an E2E test that opens each claim and asserts a
citation, rather than by inspection.

**Decisions this slice forced:** the brief is composed from filing rows rather than generated
by a model ([ADR 0010](decisions/0010-the-funder-brief-is-composed-not-generated.md)), and
ProPublica degrades rather than failing the page
([ADR 0011](decisions/0011-propublica-is-a-degradable-dependency.md)).

**A note on the E2E fixture.** The committed bundle is one year of filings: no funder in it
appears in two tax years, and exactly one of its entities has more than one funder. Turnover
over time and shared-funder proximity therefore cannot be exercised end to end against it, and
E2E asserts only that those sections render honestly — including their empty states. Both
behaviours are proved at the integration tier in
`tests/integration/report-funder-reachability.int.test.ts`, against a real libSQL database
seeded with a multi-year graph shaped exactly as the ingest use case writes one. Replacing the
fixture with a multi-year slice would let the E2E tier cover them directly.

---

## S3 — Federal sweep and fit scoring

**Goal:** the other source of money — posted federal opportunities — with the first model calls
in the system, arranged so that deterministic rules reject most announcements at zero model cost
and only survivors reach a model.

- [x] Grants.gov search ingestion, deduplicated
- [x] Deterministic eligibility screening **before any model call** — applicant type, 501(c)(3), geography, country
- [x] Every rejection stores a readable reason
- [x] Fit score 0–100 with schema-validated rationale, matched program areas, and gaps
- [x] LLM orchestrator: token bucket, priority queue, cascade, content-hash cache, repair loop, graceful degradation
- [x] Federal opportunity board UI
- [x] Run log surface: records processed, parse faults, model spend, cache hits

**Done when:** a user opens the federal board and every row either shows a fit score with its
matched program areas and gaps, or states in a sentence why the organisation cannot apply —
verified by an E2E test that asserts a real announcement open only to state governments carries
a reason and no score.

**Result on the live feed:** the fixture set is 15 real announcements recorded from
`api.grants.gov` on 8 August 2026. For a Wilmington NC literacy organisation, screening rejects
`PAR-25-003` (state governments only) and `HRSA-26-045` (the Delta States program, limited to
eight states that do not include North Carolina) without a model call, and scores the survivors.

**Decisions this slice forced:** eligibility is a rule and fit is a judgement, with "undecided"
as a real third answer ([ADR 0012](decisions/0012-eligibility-is-a-rule-and-fit-is-a-judgement.md)),
and every model call goes through one orchestrator whose quota exhaustion is a persisted queue
([ADR 0013](decisions/0013-every-model-call-goes-through-one-orchestrator.md)).

**Two limits, stated rather than hidden.** Grants.gov has no structured field for geography, so
the geographic check is a conservative scan of the announcement's eligibility prose: it
under-detects rather than over-rejects, and quotes the phrase it matched. And the Gemini
envelope the integration and E2E tiers speak is the documented shape rather than a recording —
Merit is designed to run with no model credential, so the suite must not need one. The live
half of `tests/contract/gemini.contract.test.ts` runs when `GEMINI_API_KEY` is set and is what
keeps that shape true.

---

## S4 — Rubric extraction, drafting, self-critique

- [ ] Attachment download and `pdftotext -layout` extraction
- [ ] Rubric parsed into criteria, sub-criteria, and point values, with a confidence score
- [ ] Below the confidence threshold: fall back to summary-conditioned drafting **and say so**
- [ ] Section drafting conditioned on the sub-criteria that section is scored against
- [ ] Critique pass scoring per criterion; **every score must cite a supporting sentence or the validator rejects it**
- [ ] Revision weighted by points available
- [ ] Draft studio UI: draft beside rubric, per-criterion scores before and after, weak criteria flagged with what the human must supply
- [ ] Foundation drafting conditioned on the funder's own observed purpose language
- [ ] Eval: rubric extraction accuracy, critique calibration against human scores

---

## S5 — Competitive positioning

- [ ] USASpending join on the program number Grants.gov returns
- [ ] Winner cohort: size distribution, median award vs ceiling, awards per cycle, repeat concentration, trend
- [ ] **Competitive base rate**, with the no-denominator caveat rendered inline in the UI, not buried
- [ ] Award history table shown so the user can check the call rather than trust it

---

## S6 — Scheduled work and real-world action

- [ ] Exactly three Cloud Scheduler jobs: daily sweep 06:00, deadline watch 07:00, weekly briefing Monday 08:00
- [ ] Backward-planned milestones written to Google Calendar, reviewed before commit
- [ ] Gmail: high-fit alerts above a configurable threshold, at-risk warnings, weekly ED briefing
- [ ] **Alerts only above threshold — silence is a feature**
- [ ] Job handlers idempotent; a duplicate scheduler delivery sends nothing twice
- [ ] Contract tests for Calendar and Gmail (the only unverified dependencies in the design)

---

## S7 — Ask the graph

- [ ] Typed, parameterised query tools — the model never sees raw SQL or raw tables
- [ ] Results rendered as inspectable rows with the generating query shown
- [ ] Refuses to answer beyond the tools rather than improvising

---

## S8 — Learning and planning

- [ ] Accept / reject / override captured with reason
- [ ] Prospect feedback retunes that organisation's four component weights
- [ ] Draft edits diffed against generated text, persistent edits folded into the drafting profile
- [ ] Bid/no-bid recorded against the agent's recommendation, disagreement rate visible
- [ ] Portfolio shortlist under the quarterly application-count constraint, with what is given up made explicit
- [ ] Resolution review queue for the uncertain band

---

## Deferred — do not start

Multi-tenant hardening · full multi-year corpus · budget construction · post-award reporting ·
state and local opportunity sources.
