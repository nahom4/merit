# 📖 Learning Notes

Durable notes on the concepts, decisions, and gotchas in this codebase. Written per
[LEARNING.md](../LEARNING.md): one concept per file, whole → parts → details, every claim
pointed at the line of real code that demonstrates it.

---

## Notes 01–12: understanding Merit end to end

These twelve were written together as a guided path through the whole project, so they are
listed in **reading order** rather than newest-first. Later notes assume the earlier ones.
Notes added from here on go at the top of the "Later notes" section below.

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
