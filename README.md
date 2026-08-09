# Merit

**An AI development officer for small nonprofits.**

Merit finds the foundations that would realistically fund a specific small nonprofit, tells the
organisation whether each one is worth approaching and what to ask for, drafts the application,
and manages the deadlines. It works on a schedule without being asked.

The money a small nonprofit lives on is never announced. There is no RFP, no listing, no deadline
to watch — so a tool built on opportunity feeds cannot see it. But every grant-making organisation
in the United States files a tax return itemising every grant it made: recipient, address, purpose,
amount. The IRS publishes these in bulk, free. That corpus is the US foundation giving graph.
Merit builds it, and puts an agent to work on it.

**Validated, not assumed.** 1,481,866 grant records across 73,988 distinct funders were ingested
from the 2025 IRS corpus. Three real nonprofits were run against it. A $656k literacy council in
Wilmington NC surfaced 130 credible, material funders, 66 of them regional — foundations that post
nothing, anywhere. Details in [`validation/RESULTS.txt`](validation/RESULTS.txt).

---

## Start here

| Document | What it is |
|---|---|
| **[Merit.md](Merit.md)** | The product spec. Source of truth for *what* we build |
| [docs/architecture.md](docs/architecture.md) | Layers, the dependency rule, how it is enforced |
| [docs/testing.md](docs/testing.md) | TDD cycle, the five test tiers, what may be mocked |
| [docs/conventions.md](docs/conventions.md) | Naming, types, errors, React, git |
| [docs/roadmap.md](docs/roadmap.md) | Vertical slices and acceptance criteria. **Start at the current one** |

Earlier drafts of the spec (`SRS.md`, `SRS-v2.md`, `SRS-v3.md`) are kept for history.
`Merit.md` supersedes them.

---

## The four rules

1. **Test first.** No production line without a failing test that demands it.
2. **Dependencies point inward.** `domain ← application ← infrastructure ← apps`.
3. **Ship vertical slices.** One feature end to end before starting the next.
4. **No shortcuts.** No `any`, no skipped tests, no silent fallbacks.

---

## Structure

```
apps/web            Next.js — UI, API routes, scheduled job handlers
apps/worker         offline pipeline — ingest, resolve, compute signals
packages/domain     pure logic. zero runtime dependencies
packages/application use cases + ports
packages/infrastructure adapters: libSQL, IRS, Grants.gov, USASpending, Gemini, Google
packages/shared     Result, branded types, errors
tests/              integration · contract · e2e
evals/              the measurement harness and its committed thresholds
validation/         the original thesis validation against the real corpus
tools/              document build
```

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind |
| Backend | Next.js API routes and job handlers on Cloud Run |
| Offline jobs | Node workers — streaming, checkpointed, resumable |
| Scheduler | Cloud Scheduler, three jobs |
| Database | Turso / libSQL |
| Model | Gemini 2.5 Flash |
| Validation | Zod at every boundary |
| Tests | Vitest, Playwright |
| PDF text | `pdftotext` (poppler) |

**No credit card at any point.** Every data source is free and unauthenticated; Google Calendar
and Gmail use OAuth with no billing account. Adding a paid dependency requires an ADR.

---

## Getting started

```bash
pnpm install
cp .env.example .env.local     # every key documented with where to get it
pnpm db:migrate
pnpm gate                      # types, lint, boundaries, unit, integration
pnpm dev
```

### Building the corpus

The giving graph is not committed — it is 3GB of public data, reproducible on any machine
with no account and no card:

```bash
pnpm worker ingest      # download and stream-parse the 13 IRS bundles, checkpointed
pnpm worker load-bmf    # load the IRS registry every recipient string is linked against
pnpm worker resolve     # link recipient strings to registered organisations
pnpm eval               # measure resolution accuracy and prospect coverage
```

Refitting the linker's thresholds, when the scorer or the corpus changes:

```bash
pnpm eval:fit                   # sweep the grid, write evals/link-threshold-curve.json
pnpm worker resolve --reset     # rebuild the graph under the new thresholds
```

Each step is resumable. A killed worker restarts where it stopped.

### Commands

```bash
pnpm dev            # Next.js
pnpm worker <job>   # offline pipeline job
pnpm test           # unit — fast
pnpm test:watch     # the TDD loop
pnpm test:int       # integration — real database
pnpm test:contract  # live third-party APIs
pnpm test:e2e       # Playwright
pnpm eval           # measurement harness
pnpm eval:fit       # refit the link thresholds against the labelled set
pnpm gate           # everything CI runs. green before every commit
```

---

## What Merit does not do

Program officer relationships, board politics, and the judgement of what an organisation should
become are not automatable. Budget construction is assist-only. Post-award reporting is out of scope.

**The agent never submits an application and never contacts a funder.**
