# 06 — Ports, Adapters, Use Cases, and the Composition Root

**TL;DR:** A use case declares what it needs as an interface (a *port*) and never learns what satisfies it. Adapters implement ports. Exactly one file per runtime — the composition root — knows about both. That inversion is what makes a use case unit-testable in microseconds and integration-testable against a real database with no change to its code.

## The big picture

```
   application/                      infrastructure/                apps/
   ─────────────                     ───────────────                ─────
   ┌──────────────────┐
   │ ScoreProspects   │ ──depends on──► ProspectRepository ◄──implements── LibsqlProspectRepository
   │ (use case)       │                 (port, an interface)
   └──────────────────┘                        ▲
                                               └──implements── InMemory… (tests)

                                                        container.ts  ← the only place
                                                                        `new` is called
```

The arrow from adapter to port points **backwards** relative to the call at runtime — the adapter is called *by* the use case but *depends on* the use case's interface. That is dependency inversion, and it is why `application` can be compiled with no knowledge that libSQL exists.

## The three participants

### 1. A port is an interface in `application/ports/`

```ts
// packages/application/src/ports/organization-repository.port.ts:5-16
/**
 * Persistence for the organisation Merit works on behalf of.
 *
 * The port returns domain types, never rows. Row-to-domain mapping is the adapter's job,
 * and a row that will not map is a parse fault the adapter reports -- not a half-built
 * object handed upward.
 */
export interface OrganizationRepository {
  save(organization: Organization): Promise<Result<void, RepositoryUnavailable>>;
  findById(id: OrganizationId): Promise<Result<Organization | null, RepositoryUnavailable>>;
  findByEin(ein: Ein): Promise<Result<Organization | null, RepositoryUnavailable>>;
}
```

Three properties to notice, all deliberate:

- **Domain types in the signature, never rows.** `Organization`, not `Record<string, unknown>`.
- **`Result`, not exceptions.** The port's failure mode is part of its type.
- **`Organization | null` for "not found".** Absence is an expected outcome of a lookup, so it is a value; `RepositoryUnavailable` is reserved for the database genuinely failing. Two different questions, two different channels.

The port catalogue as it stands:

| Port | Provides |
|---|---|
| `OrganizationRepository` | The nonprofit's own profile |
| `GrantRepository` | Idempotent grant upserts + ingest checkpoints |
| `EntityRepository` | BMF candidates by blocking key, unresolved grants, link writes |
| `ProspectRepository` | Peers, candidate funders, funder grant histories |
| `Clock` | `now()` — because `Date.now()` is banned outside adapters |
| `IdGenerator` | `next()` — because `Math.random()` is too |

`Clock` is six lines and earns every one of them:

```ts
// packages/application/src/ports/clock.port.ts:1-7
/**
 * Time is injected. `Date.now()` outside this port makes a test depend on wall time,
 * and untestable code is not shippable code (docs/conventions.md).
 */
export interface Clock { now(): Date; }
```

### 2. A use case orchestrates, and does nothing else

```ts
// packages/application/src/use-cases/create-organization/create-organization.use-case.ts:10-46 (abridged)
/**
 * The id is generated rather than supplied, so the caller cannot collide with an existing
 * record, and the EIN is checked first: two profiles for one EIN would split an
 * organisation's funder history across two prospect lists.
 */
export class CreateOrganization {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: unknown): Promise<Result<Organization, CreateOrganizationError>> {
    const parsed = Organization.parse({ ...input, id: this.ids.next() });   // domain decides validity
    if (!parsed.ok) return parsed;

    const existing = await this.organizations.findByEin(parsed.value.ein);  // port
    if (!existing.ok) return existing;
    if (existing.value !== null) return err(new DuplicateOrganization(…));  // application rule

    const saved = await this.organizations.save(parsed.value);              // port
    if (!saved.ok) return saved;
    return ok(parsed.value);
  }
}
```

Note the division of labour precisely: **domain** decides whether an EIN is well-formed; **application** decides that two organisations may not share one. The first is a fact about EINs; the second is a policy about *this system*. Neither is in the adapter, and neither is in the UI.

Also note `execute(input: unknown)`. The use case is a boundary — it accepts whatever the form or CLI hands it and parses immediately.

### 3. Adapters implement ports and translate

```ts
// packages/infrastructure/src/persistence/libsql-prospect.repository.ts:26-54 (abridged)
async findPeers(query: PeerQuery): Promise<Result<readonly PeerEntity[], RepositoryUnavailable>> {
  try {
    const result = await this.db.execute({ sql: `SELECT … FROM entities e WHERE …`, args: [...] });
    return ok(result.rows.map((row) => ({ ein: String(row['ein']), … })));
  } catch (cause) {
    return err(unavailable('findPeers', cause));   // driver exception → Result, at the edge
  }
}
```

The `try/catch → Result` conversion happens **here**, once, at the lowest level. Nothing above ever sees a libSQL exception. That is the "every error crossing a boundary is logged once, at the boundary" rule from `docs/conventions.md`, implemented.

## The composition root

```ts
// apps/web/src/composition/container.ts:11-33
/**
 * The only place adapters are constructed. Everything above this file takes ports.
 *
 * Next.js re-evaluates modules across dev reloads, so the client is memoised on
 * globalThis rather than rebuilt per request -- a new connection per render exhausts
 * file handles under E2E.
 */
const globalForDb = globalThis as unknown as { meritDb?: Database };

const database = (): Database => {
  const config = loadConfig();
  globalForDb.meritDb ??= createDatabase({ url: config.DATABASE_URL, authToken: … });
  return globalForDb.meritDb;
};

export const organizationRepository = () => new LibsqlOrganizationRepository(database());
export const createOrganization = () => new CreateOrganization(organizationRepository(), uuidIdGenerator('org'));
```

That `globalThis` memoisation is a genuine Next.js gotcha worth remembering: **the App Router re-evaluates modules across dev reloads and route segments**, so a module-level `const db = createDatabase(…)` produces a new connection per reload and eventually exhausts file handles. Pinning it to `globalThis` is the standard workaround. The comment records that it was found under E2E, not theorised.

The worker's composition root is even thinner — a job table:

```ts
// apps/worker/src/main.ts:10-14
const JOBS: Record<string, (args: readonly string[]) => Promise<void>> = {
  ingest: (args) => ingestCorpus(args.length > 0 ? args : undefined),
  'load-bmf': () => loadBmf(),
  resolve: () => resolveRecipients(),
};
```

## Why it mattered here — what the inversion buys

**Unit tests with no database.** `application/src/testing/` ships hand-written fakes — `InMemoryOrganizationRepository`, `FixedIdGenerator` — so a use-case test runs in microseconds with no setup:

```ts
const repo = new InMemoryOrganizationRepository();
const result = await new CreateOrganization(repo, new FixedIdGenerator('org_1')).execute(input);
```

`docs/testing.md` is explicit that **hand-written fakes beat mocking frameworks**: *"`InMemoryFunderRepository` is easier to read and harder to get wrong than five lines of `vi.mock`."* A fake is type-checked against the port; a mock is a string and a guess.

**Integration tests with a real database and no code change.** The same use case, same test assertions, constructed with `LibsqlOrganizationRepository` over a real libSQL file. See [note 10](10-the-five-test-tiers.md).

**A worker and a web app sharing one core.** `ScoreProspects` does not know whether it was called from a Next.js server component or a CLI job.

**Ports as the seam for measurement.** `ResolveRecipients` takes an `ignoreStatedEin` option ([`resolve-recipients.use-case.ts:24-29`](../packages/application/src/use-cases/resolve-recipients/resolve-recipients.use-case.ts#L24-L29)) so the *same* pipeline can be run against withheld ground truth to produce precision and recall. That is only cheap because the pipeline has no hidden I/O.

## A subtlety: ports are type-only imports

Because ports are interfaces, `import type { OrganizationRepository }` erases completely at compile time. Two consequences already bitten into the config:

- dependency-cruiser needs `tsPreCompilationDeps: true` or it cannot see port edges and calls every interface an orphan — [`.dependency-cruiser.cjs:68-70`](../.dependency-cruiser.cjs#L68-L70).
- ESLint enforces `consistent-type-imports` so the distinction stays explicit — [`.eslintrc.cjs:39`](../.eslintrc.cjs#L39).

## Applied in this project

- [`packages/application/src/ports/`](../packages/application/src/ports/) — every port
- [`packages/application/src/testing/`](../packages/application/src/testing/) — the hand-written fakes
- [`packages/infrastructure/src/persistence/`](../packages/infrastructure/src/persistence/) — the libSQL adapters
- [`apps/web/src/composition/container.ts`](../apps/web/src/composition/container.ts) · [`apps/worker/src/main.ts`](../apps/worker/src/main.ts) — the two composition roots
- [`packages/infrastructure/src/system.ts`](../packages/infrastructure/src/system.ts) — `Clock` and `IdGenerator` implementations

## Trade-offs / alternatives

**Why no DI container/framework?** Two composition roots of ~30 lines each. A container would add indirection, a registration DSL, and runtime resolution errors in exchange for solving a problem this size does not have. Plain functions calling `new` are greppable.

**Why factory functions (`organizationRepository()`) rather than exported singletons?** Under Next.js the module is re-evaluated unpredictably; a factory plus the `globalThis` cache makes the lifetime explicit rather than accidental.

**Cost:** an interface, an implementation, and a fake for every capability — three files where one would do. Accepted, because it is the only way to keep the application layer testable without infrastructure.

## Learn more

- [Alistair Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)
- [Martin Fowler — Inversion of Control Containers and the Dependency Injection pattern](https://martinfowler.com/articles/injection.html)
- [Martin Fowler — Test Double](https://martinfowler.com/bliki/TestDouble.html) — the fake/mock/stub distinction `docs/testing.md` relies on
- [Next.js — App Router](https://nextjs.org/docs/app)
