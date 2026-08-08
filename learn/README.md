# 📖 Learning Notes

Durable notes on the concepts, decisions, and gotchas in this codebase. Written per
[LEARNING.md](../LEARNING.md): one concept per file, whole → parts → details, every claim
pointed at the line of real code that demonstrates it.

---

## How to read these

Notes are listed in **reading order**, not newest-first, because later ones assume earlier ones.
Every note carries a status:

- **Built** — running code. Line references are real, and `pnpm gate` covers them.
- **Designed** — specified in [Merit.md](../submission_docs/Merit.md) and the roadmap, not yet
  written. These exist so you can read *ahead* of an agent: what it is about to build, what it
  must not do, and how to check its work. When the slice lands, the note is rewritten against the
  real code and its status flips.

Currently **Built**: S0, S1, S2, S3 (notes 01–16). **Designed**: S4–S8 (notes 17–21).

If you are new here, read [13 — the whole of Merit, S0 → S8](13-the-whole-of-merit-s0-to-s8.md)
first. It is the map; notes 01–12 are the detail of the part that already exists.

---

## Notes 01–12: understanding what is built (S0–S1)

These twelve were written together as a guided path through the parts of the project that existed
at the time — the architecture, the ingestion pipeline, and prospect discovery.

**Start with the problem and the shape**

- [01 — What Merit is: the problem, the insight, the vocabulary](01-what-merit-is.md) — foundation money is invisible, but every foundation files a tax return; plus the domain words you must use exactly.
- [02 — The layered architecture: five packages, one direction](02-the-layered-architecture.md) — `shared ← domain ← application ← infrastructure ← apps`, and why each layer is a package rather than a folder.
- [03 — Enforcing the dependency rule (and testing the enforcement)](03-enforcing-the-dependency-rule.md) — four overlapping mechanisms, plus a CI script that writes real violations to prove the checks actually reject them.

**The type-level foundations**

- [04 — `Result<T, E>` and the line between a failure and a bug](04-result-types-and-when-to-throw.md) — expected failure is a value; an unknown 990 schema version throws on purpose, because a silent zero is the worst outcome this system has.
- [05 — Branded types and "parse, don't validate"](05-branded-types-and-parse-dont-validate.md) — an EIN is not a string, money is integer cents, and a type in scope is proof it was checked.
- [06 — Ports, adapters, use cases, and the composition root](06-ports-adapters-and-composition.md) — dependency inversion in practice: one interface, one adapter, one hand-written fake, one place that calls `new`.

**The pipeline that builds the product**

- [07 — Ingesting the IRS corpus: streaming, resuming, reconciling](07-ingesting-the-irs-corpus.md) — Range-request resumption, bounded-memory zip streaming, dual checkpoints, and filings that reconcile against their own stated totals.
- [08 — Entity resolution: turning `ST PATRICK CATHOLIC SCH` into a real organisation](08-entity-resolution.md) — normalise, block, score, decide three ways — and 80,000 free labels a year from withheld Schedule I EINs.
- [09 — Funder signals and the prospect score](09-funder-signals-and-the-prospect-score.md) — turnover, HHI, first-time ask; four components never collapsed into one, and why a null component redistributes its weight instead of scoring zero.

**Delivering it, and working on it**

- [10 — The five test tiers, and where mocks are allowed](10-the-five-test-tiers.md) — unit may mock, nothing else may; real libSQL per test file; evaluation as a gated test tier.
- [11 — The web layer: view-models, server actions, and states that explain themselves](11-the-web-layer-and-view-models.md) — pure unit-tested formatting, four bars never one number, and three different kinds of empty.
- [12 — Vertical slices, `pnpm gate`, and how to actually work here](12-slices-the-gate-and-how-to-work.md) — outside-in from a failing E2E, the gate's deliberate ordering, conventions, and when to write an ADR.

## Note 13: the map of the whole product

- [13 — The whole of Merit, S0 → S8](13-the-whole-of-merit-s0-to-s8.md) — **the frame.** All eight slices on one page: what each adds, which tables it touches, where its code lands, and what is built versus designed.

## Notes 14–21: slice by slice, including what has not been built yet

- [14 — The funder reachability report](14-the-funder-reachability-report.md) — *S2, **Built***. "Should we bother": a brief composed from filing rows rather than generated, so every claim cites a source structurally; ask calibration from first grants; ProPublica allowed to fail out loud.
- [15 — The federal sweep, screening, and the fit score](15-federal-sweep-and-eligibility-screening.md) — *S3, **Built***. Deterministic eligibility before any model call, and why that cascade is what makes the fit score defensible and the free tier survivable.
- [16 — The LLM orchestrator](16-the-llm-orchestrator.md) — *S3+, **Built***. 15 requests a minute, 1,500 a day: cascade, content-hash cache, token bucket, priority queue, repair loop — and degrading instead of failing. The most reusable engineering in the project.
- [17 — Rubric extraction, drafting, self-critique](17-rubric-extraction-drafting-and-self-critique.md) — *S4, **Designed***. The announcement PDF carries a 110-point rubric; every critique score must cite a sentence or the validator rejects it; low extraction confidence degrades loudly.
- [18 — Competitive positioning and the missing denominator](18-competitive-positioning-and-the-missing-denominator.md) — *S5, **Designed***. Award history joins on the program number. Public data never records who applied and lost, so it is a base rate and never a win probability.
- [19 — Scheduled work, Calendar and Gmail](19-scheduled-work-calendar-and-gmail.md) — *S6, **Designed***. Exactly three cron jobs, idempotent handlers because delivery is at-least-once, alerts only above threshold — and the only two dependencies nobody has verified yet.
- [20 — Ask the graph: typed tools, not SQL](20-ask-the-graph-typed-tools-not-sql.md) — *S7, **Designed***. Why text-to-SQL is rejected, what a query tool looks like, and why refusing to answer is a feature.
- [21 — Learning, planning, and the review queue](21-learning-planning-and-the-review-queue.md) — *S8, **Designed***. Feedback retunes one organisation's weights without collapsing the four bars; the shortlist is a sort and says so; the uncertain band finally gets a screen.

## Note 22: working with an agent on this codebase

- [22 — How to review a slice an agent says is done](22-how-to-review-a-slice.md) — the six questions, reading the diff inward-out, the failure patterns specific to this codebase, and one sharp question per slice.

## Later notes

_(newest at the top — add new notes here)_

---

## Where else to look

| Document | What it is |
|---|---|
| [Merit.md](../submission_docs/Merit.md) | The product spec — source of truth for *what* gets built |
| [CLAUDE.md](../CLAUDE.md) | The four working rules — source of truth for *how* |
| [docs/roadmap.md](../docs/roadmap.md) | Slices and acceptance criteria. **Start each session here** |
| [docs/architecture.md](../docs/architecture.md) | Layers, the dependency rule, how it is enforced |
| [docs/testing.md](../docs/testing.md) | The TDD cycle, the five tiers, what may be mocked |
| [docs/conventions.md](../docs/conventions.md) | Naming, types, errors, React, git |
| [docs/decisions/](../docs/decisions/) | ADRs — why things are the way they are |
| [validation/RESULTS.txt](../validation/RESULTS.txt) | The original thesis validation the constants are fitted against |
