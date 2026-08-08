# 12 — Vertical Slices, `pnpm gate`, and How to Actually Work Here

**TL;DR:** Work one slice at a time, outside-in: failing E2E → domain → application → infrastructure → UI → E2E green. A slice is done when a real user can do the thing on a real screen against real data. Before every commit, `pnpm gate` runs the same eight checks CI runs, in a deliberate order — cheapest and most-informative first.

## The big picture

```
  docs/roadmap.md  ── tells you the current slice and its acceptance criteria
        │
        ▼
  /slice   ── plan and drive it outside-in
        │
        ▼
  /tdd     ── one Red → Green → Refactor cycle per behaviour
        │      (/use-case and /adapter scaffold the layers, tests first)
        ▼
  pnpm gate ── format · types · lint · boundaries · prove-boundaries · domain-pure
        │      · no-skipped · unit · integration
        ▼
  /adr     ── if the change constrains the future, record why
```

## Why vertical slices

A slice is **not** done because the backend works. It is done when a real user can do the thing on a real screen against real data, with tests at every tier proving it.

The slice order in [docs/roadmap.md](../docs/roadmap.md) follows **value, not dependency convenience**:

| Slice | Delivers |
|---|---|
| **S0** | Walking skeleton — the architecture and test harness, proven |
| **S1** | **Prospect discovery** — profile in, ranked funders with evidence out |
| S2 | Funder reachability report — "should we bother" |
| S3 | Federal sweep, eligibility screening, fit scoring |
| S4 | Rubric extraction, drafting, self-critique |
| S5 | Competitive positioning from award history |
| S6 | Scheduled jobs, Calendar milestones, Gmail digests |
| S7 | Ask the graph — conversational query |
| S8 | Feedback learning, portfolio planner, review queue |

> S1 is the product's central claim — *here are foundations that would fund you, and none of them posted anything anywhere.* Everything before it exists to make S1 possible; everything after it is leverage on S1.

**Do not start slice N+1 while slice N has an unchecked acceptance criterion.**

### S0 is the one people want to skip

> **Goal:** one trivial feature travels every layer, so the architecture and all five test tiers are proven before real logic is written. Do not skip this. Everything after copies its shape.

The feature is deliberately trivial — create an organisation profile, read it back. The *point* is the harness: workspace and strict TypeScript, boundary enforcement **with proof it fails**, Vitest and Playwright wired, `freshDatabase()`, `Result` and branded types, one domain type at 100%, two use cases with fakes *and* real DB, one adapter, one route with a unit-tested view-model, one E2E, `pnpm gate`, CI.

> **Done when:** a new contributor clones, runs `pnpm gate`, and it is green in under five minutes.

Worth knowing while reading this repo: **the S0 checkboxes in `docs/roadmap.md` are still unticked, but substantial S1 machinery already exists** — IRS ingestion, entity resolution, funder signals, prospect scoring, the giving-graph schema. Treat the roadmap's checkboxes as the authority on what is *accepted*, and the code as work in progress against them. Closing S0's boxes honestly (E2E green, gate green, CI running) is the current job.

## Order of work inside a slice

**failing E2E → domain → application → infrastructure → UI → E2E green.**

Outside-in, and the reason is that the E2E test is the acceptance criterion written down. Writing it first forces you to decide what "done" means before you have any sunk cost in a design. [`s0-organization-profile.spec.ts`](../tests/e2e/s0-organization-profile.spec.ts) is literally S0's criterion, executable.

Inside each layer, one Red → Green → Refactor cycle **per behaviour**, not per file. See [note 10](10-the-five-test-tiers.md).

## `pnpm gate` — the one command

```json
// package.json:33
"gate": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm boundaries
       && pnpm boundaries:prove && pnpm domain-pure && pnpm no-skipped-tests
       && pnpm test && pnpm test:int"
```

The order is not arbitrary. `&&` means it stops at the first failure, so the sequence runs **cheapest and most-localised first**:

| Step | Catches | Cost |
|---|---|---|
| `format:check` | Prettier drift | instant |
| `typecheck` | `tsc --noEmit` across the workspace | seconds |
| `lint` | `--max-warnings 0`: no `any`, no `fetch` global, no `Date.now` in domain, kebab-case files | seconds |
| `boundaries` | dependency-cruiser: layer violations, cycles, orphans | seconds |
| `boundaries:prove` | **that the boundary checks actually reject violations** | slow (shells out 8×) |
| `domain-pure` | domain/shared `package.json` stayed dependency-free | instant |
| `no-skipped-tests` | `.skip`, `.only`, `xit`, `fdescribe` | instant |
| `test` | unit suite | fast |
| `test:int` | integration against real libSQL | slowest |

A type error should never cost you a database spin-up to discover.

Two tiers are deliberately **not** in the gate: `test:contract` (live third-party APIs — an outage must not block a merge) and `eval` (slow). Both run nightly. See [ADR-0002](../docs/decisions/0002-integration-tests-use-real-infrastructure.md) and [ADR-0003](../docs/decisions/0003-evaluation-is-a-test-tier.md).

E2E (`pnpm test:e2e`, Playwright) runs on every PR rather than in the local gate.

## The skills

Repeatable workflows live in `.claude/skills/` and are invoked by name:

| Skill | Use it to |
|---|---|
| `/slice` | Plan and drive a vertical slice end to end |
| `/tdd` | Run one Red → Green → Refactor cycle properly (enforces watching it fail) |
| `/use-case` | Scaffold a use case across domain, application, persistence — tests first |
| `/adapter` | Scaffold an infrastructure adapter with integration and contract tests |
| `/gate` | Run the full quality gate and **report the result honestly** |
| `/adr` | Record an architectural decision |

The honesty clause in `/gate` matters: *"Never mark a task complete with a failing or skipped test. Report the failure instead."*

## The everyday commands

```bash
pnpm dev            # Next.js
pnpm worker ingest  # offline pipeline job — also: load-bmf, resolve
pnpm db:migrate     # apply committed migrations

pnpm test           # unit — fast, run constantly while working
pnpm test:watch     # the TDD loop
pnpm test:int       # integration — real database
pnpm test:contract  # live third-party APIs (nightly tier)
pnpm test:e2e       # Playwright
pnpm eval           # the measurement harness

pnpm gate           # everything CI runs. green before every commit
```

## Conventions you will be corrected on

**Files** are always `kebab-case.ts`, with a suffix naming the kind:

| Kind | Pattern | Example |
|---|---|---|
| Domain type | `<concept>.ts` | `funder-signals.ts` |
| Domain policy | `<verb>-<noun>.ts` | `compute-turnover.ts` |
| Use case | `<verb>-<noun>.use-case.ts` | `score-prospects.use-case.ts` |
| Port | `<noun>.port.ts` | `funder-repository.port.ts` |
| Adapter | `<vendor>-<noun>.<kind>.ts` | `libsql-funder.repository.ts` |
| Schema | `<noun>.schema.ts` | `grants-gov-opportunity.schema.ts` |
| View-model | `view-model.ts` | one per feature folder |
| Unit test | `<subject>.test.ts` | colocated |
| Integration test | `<subject>.int.test.ts` | `tests/integration/` |
| E2E | `<slice>.spec.ts` | `tests/e2e/` |
| Migration | `NNNN-<description>.sql` | `0003-add-entity-links.sql` |

**Commits** are Conventional Commits with the slice in scope, on a `slice/<n>-<name>` branch:

```
feat(prospects): rank funders by openness and affinity
fix(ingest): resume from checkpoint after dropped SSL connection
test(resolution): add held-out precision measurement
docs(adr): record why entity resolution anchors on the BMF
```

Small commits, each one green. *"A red commit on a shared branch is a broken build for everyone."*

**Comments say why, never what**, and every non-obvious constant cites its source:

```ts
/** 0.5% of revenue, floored at $2,500 — validated against three real organisations
 *  in validation/RESULTS.txt. Below this a grant is not worth an application. */
const MATERIALITY_FLOOR_RATE = 0.005;
```

Reading this codebase, that convention is the single biggest reason it is followable at all. Almost every non-obvious line has its reasoning attached, and often its *incident history* — "this happened repeatedly during the live validation run".

## Definition of done

A change is done when **all** of these are true:

- [ ] Tests were written first, and the red step was actually observed
- [ ] Happy path and key failure modes covered
- [ ] Integration test passes against real infrastructure
- [ ] `pnpm gate` is green
- [ ] No new `any`, no skipped test, no commented-out code
- [ ] Names match [docs/conventions.md](../docs/conventions.md)
- [ ] Behaviour change is reflected in the slice's acceptance criteria
- [ ] A decision that constrains the future has an ADR in [docs/decisions/](../docs/decisions/)

## When to write an ADR

When a future contributor would otherwise have to reverse-engineer *why*: choosing a library or service, changing a layer boundary or data model, renaming a domain concept, adding a paid dependency, changing an eval threshold.

The four existing ADRs are short and worth reading in one sitting — they are the best available demonstration of the house style of reasoning:

- [0001](../docs/decisions/0001-layers-as-workspace-packages.md) — layers as workspace packages
- [0002](../docs/decisions/0002-integration-tests-use-real-infrastructure.md) — real infrastructure, separate contract tier
- [0003](../docs/decisions/0003-evaluation-is-a-test-tier.md) — evaluation is a gated test tier
- [0004](../docs/decisions/0004-domain-may-import-shared.md) — domain may import `@merit/shared`, and nothing else

Each has the same shape: **Context → Decision → Consequences (including the accepted cost) → Alternatives considered, with why each was rejected.** ADR-0004 is the model for what to do when a rule turns out to be self-contradictory: not route around it, not silently weaken it — write down the precise version and what it still guarantees.

## The hard constraints you cannot design around

- **Free tier is absolute.** No service requiring a credit card. Exactly three Cloud Scheduler jobs, not four. Adding a paid dependency is an ADR.
- **Never invent a data field.** Every field comes from a verified source in the `Merit.md` appendix, or from a live probe you ran and can quote.
- **The agent never submits an application and never contacts a funder.**

## Why it mattered here

Merit is one developer plus agents, building a system whose failure mode is *plausible wrong answers at scale*. Slices keep the thing shippable at every point; the gate makes "done" a command rather than a judgement; ADRs stop the same argument being had twice. None of it is ceremony — each piece exists because the alternative already went wrong once.

## Applied in this project

- [`docs/roadmap.md`](../docs/roadmap.md) — the slices and their acceptance criteria. **Start here every session**
- [`CLAUDE.md`](../CLAUDE.md) — the four rules and the definition of done
- [`docs/conventions.md`](../docs/conventions.md) — naming, types, errors, React, git
- [`package.json`](../package.json) — the gate and every script
- [`.claude/skills/`](../.claude/skills/) — `/slice`, `/tdd`, `/use-case`, `/adapter`, `/gate`, `/adr`

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Horizontal layers first (all domain, then all UI) | Nothing is demonstrable until the end, and the UI reveals the domain was wrong |
| Separate lint/test/typecheck commands only | "Is it green?" becomes a judgement call; CI and local drift apart |
| Everything in the gate, including contract + eval | An upstream outage or a 10-minute eval blocks every commit |
| Skip S0, start on real logic | The harness gets built under pressure, badly, and never gets its enforcement tested |

**Accepted cost:** `pnpm gate` is not instant — `boundaries:prove` shells out eight times and integration tests hit a real database. Run `pnpm test:watch` while working and the full gate before committing.

## Learn more

- [Martin Fowler — Test Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Michael Nygard — Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — the ADR format these follow
- [Martin Fowler — Vertical slice / walking skeleton](https://martinfowler.com/bliki/OutsideInDevelopment.html)
