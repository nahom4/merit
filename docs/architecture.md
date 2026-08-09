# Architecture

How the code is organised, and how the organisation is enforced.

---

## 1. The shape

Merit has two runtimes over one shared core.

- **Offline plane** (`apps/worker`) — downloads IRS bundles, parses filings, resolves recipients to real organisations, computes funder signals. Long-running, checkpointed, resumable.
- **Serving plane** (`apps/web`) — Next.js. Reads the graph, runs the agent loops, takes action through Calendar and Gmail, and puts it in front of a human.

Both are thin. All logic worth testing lives in the packages below them.

```
merit/
├── apps/
│   ├── web/                    Next.js 14 App Router — UI + API routes + job handlers
│   └── worker/                 offline pipeline entrypoints
├── packages/
│   ├── domain/                 pure logic. zero runtime dependencies
│   ├── application/            use cases + ports
│   ├── infrastructure/         adapters implementing ports
│   └── shared/                 Result, branded types, errors, logger contract
├── tests/
│   ├── integration/            real database, real HTTP
│   ├── contract/               live third-party APIs
│   └── e2e/                    Playwright through the running stack
├── evals/                      the §12 measurement harness + committed thresholds
└── docs/
```

---

## 2. The dependency rule

```
domain ← application ← infrastructure ← apps
```

Arrows are the only permitted import direction. Nothing points outward, ever.

### `packages/domain`

Entities, value objects, and pure policy. **Zero third-party runtime dependencies** — not even
Zod. Its one permitted import is `@merit/shared`, which is itself dependency-free and holds
`Result`, `Brand`, and `DomainError`; see
`tools/assert-domain-pure.mjs` for the check that keeps it true.

```
domain/src/
├── organization/     Organization, RevenueBand, NteeCode, Geography
├── funder/           Funder, FunderSignals, GranteeTurnover, AskDistribution, Hhi
├── grant/            GrantRecord, RecipientString, Amount, TaxYear
├── resolution/       NormalizedName, BlockingKey, LinkScore, LinkDecision
├── prospect/         ProspectScore, Openness, Affinity, GeographyFit, SizeFit
├── opportunity/      Opportunity, EligibilityRule, FitScore, Rubric, Criterion
└── draft/            Draft, Section, CritiqueScore, Citation
```

If it can be decided from the numbers alone, it belongs here. Grantee turnover is arithmetic
over a grantee list — that is domain. Fetching the grantee list is not.

**Test with:** unit tests only. No fixtures from disk, no clock, no async.

### `packages/application`

Use cases (one per user-meaningful action) and **ports** — the interfaces the outside world must satisfy.

```
application/src/
├── ports/            FunderRepository, GrantRepository, OpportunityGateway,
│                     LlmGateway, CalendarGateway, MailGateway, Clock, IdGenerator
└── use-cases/
    ├── score-prospects/
    ├── build-funder-report/
    ├── resolve-recipients/
    ├── screen-opportunities/
    ├── extract-rubric/
    └── draft-and-critique/
```

A use case orchestrates: load through ports, decide via domain, persist through ports,
return a `Result`. It contains no SQL, no `fetch`, and no arithmetic that domain should own.

**Test with:** unit tests using in-memory fakes, **and** an integration test against the real database.

### `packages/infrastructure`

Adapters. Every file here implements a port and does one boring job well.

```
infrastructure/src/
├── persistence/      libsql-funder.repository.ts, migrations/, unit-of-work.ts
├── irs/              bundle-downloader.ts, filing-stream-parser.ts, bmf-loader.ts
├── grants-gov/       search.gateway.ts, attachment.gateway.ts
├── usaspending/      award-history.gateway.ts
├── propublica/       organization.gateway.ts
├── llm/              gemini.gateway.ts, rate-limiter.ts, cascade.ts, response-cache.ts
├── google/           calendar.gateway.ts, gmail.gateway.ts
└── pdf/              pdftotext.ts
```

Adapters translate. They must not decide. An eligibility check inside an adapter is a bug,
even when it is convenient.

**Test with:** integration tests against real infrastructure. Third-party clients also get a contract test.

### `apps/*`

Composition roots. They build the dependency graph, map HTTP and CLI to use cases, and render.
If a file in `apps/` contains logic you want to unit-test, that logic is in the wrong place.

---

## 3. Frontend architecture

The same rule, applied to React.

```
apps/web/src/
├── app/                    routes. thin: parse input → call use case → render
│   ├── (dashboard)/prospects/
│   ├── (dashboard)/funders/[id]/
│   └── api/jobs/           scheduled job handlers
├── features/               one folder per product surface, named after the slice
│   ├── prospect-list/
│   │   ├── components/     presentational. props in, JSX out
│   │   ├── hooks/          client state
│   │   ├── view-model.ts   domain type → what the screen needs. pure, unit-tested
│   │   └── actions.ts      server actions calling use cases
│   ├── funder-report/
│   ├── draft-studio/
│   └── ask-the-graph/
├── components/ui/          design system primitives. no feature knowledge
└── composition/            container.ts — the only place adapters are constructed
```

Frontend rules:

- **Client components never import `@merit/infrastructure`.** ESLint enforces it. Data reaches them through server components or server actions.
- **View-models are pure and unit-tested.** Formatting, bucketing, and label logic live there, never inside JSX.
- **Components take data, not queries.** A component that fetches is a component you cannot test.
- **Loading, empty, and error states are part of the component, not a follow-up.** A prospect list with no results must say *why* — "no comparable organisations found in this state" — never render blank.
- **Score components are never collapsed.** Openness, affinity, geography, and size fit are always four separate values, with the underlying grantee rows one click away. A development director has to defend a prospect list to a board.

---

## 4. How consistency is enforced

Discipline does not scale. Each rule below has a machine enforcing it, and all of them run in `pnpm gate`.

| Rule | Enforced by |
|---|---|
| Layer import direction | `dependency-cruiser` config + `eslint-plugin-boundaries` |
| Domain stays dependency-free | `domain/package.json` may declare only `@merit/shared`; `pnpm domain-pure` asserts it |
| The dependency rule actually fails a build | `pnpm boundaries:prove` writes four real violations, asserts both checks reject each one, and removes them |
| Client never touches infrastructure | ESLint `no-restricted-imports` in `apps/web` |
| No `any`, no unchecked index access | `tsconfig` strict + `noUncheckedIndexedAccess`, `@typescript-eslint/no-explicit-any` as error |
| File and symbol naming | ESLint `unicorn/filename-case` + review checklist |
| Every external payload parsed | Adapters return branded types only constructible via a Zod parse |
| Tests exist for changed code | Coverage thresholds per package, ratcheted up, never down |
| No skipped tests | CI fails on `.skip` / `.only` |
| Formatting | Prettier, `--check` in CI |
| Commit hygiene | Husky + lint-staged pre-commit; Conventional Commits |

**Adding a new module type?** Add its rule to `dependency-cruiser` in the same PR.
A convention nobody checks is not a convention.

---

## 5. Data flow, one slice deep

Prospect discovery, top to bottom — the shape every other slice copies:

```
IRS bundle (zip, streamed)
  → FilingStreamParser            infrastructure  bounded memory, checkpointed
  → GrantRecord[]                 domain          parsed, typed, reconciliation-checked
  → ResolveRecipients use case    application     blocks, scores, decides, queues uncertain
  → entity_links                  persistence
  → ComputeFunderSignals          application     turnover, HHI, radius, ask, retention
  → ScoreProspects use case       application     peers → candidate funders → four components
  → ProspectScore[]               domain          transparent weighted sum
  → prospect-list view-model      apps/web        four bars + evidence rows
  → Prospect list screen
```

Each arrow is a testable seam. The pipeline is not one big function anywhere.

---

## 6. Persistence notes

- **Turso / libSQL.** Analytical joins and aggregations over the graph — what SQL is for.
- **Migrations are forward-only, numbered, committed.** No auto-sync from code.
- **Repositories return domain types**, never rows. Row-to-domain mapping is the repository's job.
- **Idempotent writes.** Filings key on IRS object ID; re-processing is a no-op. Retries must be safe by construction, not by luck.
- **Checkpoints are first-class.** `ingest_checkpoints` is written before work starts, not after it succeeds.

Schema follows the data model in [Merit.md](../Merit.md) §15.
