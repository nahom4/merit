# 02 — The Layered Architecture: Five Packages, One Direction

**TL;DR:** Merit is a pnpm workspace where each architectural layer is its own package, and imports may only point inward: `shared ← domain ← application ← infrastructure ← apps`. The layering is not a convention — it is the package graph, so a violation fails to resolve at build time.

## The big picture

Six units, two runtimes, one direction of dependency.

```
   apps/web (Next.js)        apps/worker (Node CLI)     ← composition roots
        │                            │                     wire the graph, own no logic
        └──────────────┬─────────────┘
                       ▼
            packages/infrastructure                     ← adapters: libSQL, IRS, HTTP, files
                       │                                   translate; never decide
                       ▼
            packages/application                        ← use cases + ports (interfaces)
                       │                                   orchestrate; no SQL, no fetch
                       ▼
              packages/domain                           ← pure logic, pure arithmetic
                       │                                   no I/O, no clock, no randomness
                       ▼
              packages/shared                           ← Result, Brand, DomainError, Logger
                                                           depends on nothing at all
```

Arrows are the **only** permitted import direction. Nothing points outward, ever.

## What each layer is for

### `packages/shared` — the base of the graph

Types and combinators, zero dependencies (third-party *or* workspace). `Result<T,E>`, the `Brand<T,B>` mechanism, `DomainError` and its subclasses, the `Logger` interface.

It is deliberately not a "utils" package. It holds the four things every layer needs to speak the same language about success, failure, and identity.

### `packages/domain` — pure logic

Entities, value objects, and policy. **If it can be decided from the numbers alone, it belongs here.**

```
domain/src/
├── shared/        Ein, Cents                       ← branded identifiers and money
├── organization/  Organization, NteeCode, UsState  ← the nonprofit Merit works for
├── grant/         GrantRecord, TaxYear             ← one edge in the giving graph
├── funder/        FunderSignals                    ← turnover, HHI, ask distribution
├── resolution/    normalizeName, LinkScore, LinkDecision
└── prospect/      ProspectScore, materialityFloor
```

The tell that something belongs here: *grantee turnover is arithmetic over a grantee list — that is domain. Fetching the grantee list is not.*

Domain contains **no async at all**. Not one `Promise`. That is not an accident — it is what makes 100% unit coverage cheap.

### `packages/application` — use cases and ports

Two things, and only two:

**Ports** — interfaces describing what the outside world must provide. [`organization-repository.port.ts`](../packages/application/src/ports/organization-repository.port.ts), [`grant-repository.port.ts`](../packages/application/src/ports/grant-repository.port.ts), [`clock.port.ts`](../packages/application/src/ports/clock.port.ts), `id-generator.port.ts`, `entity-repository.port.ts`, `prospect-repository.port.ts`.

**Use cases** — one class per user-meaningful action, with a single `execute` method. `CreateOrganization`, `GetOrganization`, `IngestBundle`, `ResolveRecipients`, `ScoreProspects`.

A use case does exactly this shape, every time:

```
load through ports  →  decide via domain  →  persist through ports  →  return Result
```

Look at [`score-prospects.use-case.ts:69-141`](../packages/application/src/use-cases/score-prospects/score-prospects.use-case.ts#L69-L141) — three port calls, two domain calls (`computeFunderSignals`, `computeProspectScore`), one sort, one return. No SQL, no `fetch`, no arithmetic that domain should own.

### `packages/infrastructure` — adapters

Every file implements a port and does one boring job well.

```
infrastructure/src/
├── config.ts                  the one Zod schema for every env var
├── system.ts                  Clock and IdGenerator — the injected impurities
├── persistence/               libSQL repositories, migrations, migrator
└── irs/                       bundle downloader, zip stream, filing parser, extractors
```

**Adapters translate. They must not decide.** An eligibility check inside an adapter is a bug, even when it is convenient.

### `apps/*` — composition roots

They build the dependency graph, map HTTP or CLI to use cases, and render. [`apps/web/src/composition/container.ts`](../apps/web/src/composition/container.ts) is the *only* file in the web app allowed to construct an adapter. [`apps/worker/src/main.ts`](../apps/worker/src/main.ts) is a job-name-to-function table and nothing else.

**If a file in `apps/` contains logic you want to unit-test, that logic is in the wrong place.**

## Why it mattered here — ADR-0001

The obvious alternative was a single Next.js app with `src/domain`, `src/lib` folders. It was rejected for a specific reason worth internalising:

> Clean architecture only holds if the dependency rule holds, and in a single Next.js app the rule is enforced by nothing but discipline. `src/lib` becomes a junk drawer within weeks, a React component imports the libSQL client "just this once", and the layering is decorative.

Making each layer a package means an inward-pointing violation **fails to resolve** — `packages/domain/package.json` does not declare `@merit/infrastructure`, so the import cannot even be typed. That is enforcement that survives deadline pressure, which is exactly when architecture normally erodes.

There is also a second reason specific to Merit: there are **two runtimes**. `apps/worker` ingests 2M grant records offline; `apps/web` serves a UI. They share one core. Without packages, either the core gets duplicated or the worker imports React transitively.

## Example — the same rule, seen three ways

A use case declares what it needs as a type, and never learns what satisfies it:

```ts
// packages/application/src/use-cases/create-organization/create-organization.use-case.ts:17-21
export class CreateOrganization {
  constructor(
    private readonly organizations: OrganizationRepository,  // a port — an interface
    private readonly ids: IdGenerator,                       // a port — an interface
  ) {}
```

The adapter implements it and knows nothing about the use case's rules:

```ts
// packages/infrastructure/src/persistence/libsql-organization.repository.ts
export class LibsqlOrganizationRepository implements OrganizationRepository { … }
```

The composition root is the only place the two meet:

```ts
// apps/web/src/composition/container.ts:31-32
export const createOrganization = () =>
  new CreateOrganization(organizationRepository(), uuidIdGenerator('org'));
```

Swap libSQL for Postgres and only `container.ts` and one file in `infrastructure/` change. More importantly for this project: swap the real repository for `InMemoryOrganizationRepository` and the use case is unit-testable in microseconds.

## The one deliberate exception — ADR-0004

`docs/architecture.md` originally said domain has "zero runtime dependencies — not even Zod". Taken literally that contradicted itself: domain parse functions return `Result<T, ParseError>`, and `Result` lives in `shared`.

The resolution, recorded in [ADR-0004](../docs/decisions/0004-domain-may-import-shared.md), was to read the rule precisely: **zero *third-party* runtime dependencies, plus exactly one workspace import — `@merit/shared`** — which is itself dependency-free, has no I/O, no clock, no randomness and no framework types.

`packages/domain/package.json` may declare exactly one dependency. Any other entry fails `pnpm domain-pure`.

This is worth reading as a worked example of how this project handles a rule that turns out to be imprecise: not by quietly routing around it, and not by weakening it, but by an ADR that makes it exact.

## Applied in this project

- [`.dependency-cruiser.cjs:9-48`](../.dependency-cruiser.cjs#L9-L48) — the rule, mechanised
- [`.eslintrc.cjs:46-60`](../.eslintrc.cjs#L46-L60) — `boundaries/element-types`, the same rule at edit time
- [`ADR-0001`](../docs/decisions/0001-layers-as-workspace-packages.md) — why packages, not folders
- [`ADR-0004`](../docs/decisions/0004-domain-may-import-shared.md) — the domain-may-import-shared exception
- [`docs/architecture.md`](../docs/architecture.md) — the long-form version of this note

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Single app with folders + path aliases | Nothing enforces the boundary; ESLint can be disabled inline, a missing package dependency cannot |
| Separate repos per layer | Version skew and release ceremony for a single-developer project |
| Skip `shared`, duplicate `Result` in domain | Two definitions of the same type — a domain `Result` would not be assignable to an application `Result` |

The real cost paid: more configuration up front, and cross-package changes touch more files. That is a one-time cost paid in slice S0 against a permanent guarantee.

## Learn more

- [Uncle Bob — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — where the dependency rule comes from
- [Alistair Cockburn — Hexagonal Architecture (Ports and Adapters)](https://alistair.cockburn.us/hexagonal-architecture/) — where "port" and "adapter" come from
- [pnpm — Workspaces](https://pnpm.io/workspaces)
- Next: [03 — Enforcing the dependency rule](03-enforcing-the-dependency-rule.md), which is how this stays true.
