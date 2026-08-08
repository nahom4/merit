# 10 — The Five Test Tiers, and Where Mocks Are Allowed

**TL;DR:** Unit tests may mock; **nothing else may**. Integration tests run against a real libSQL database built from the committed migrations. Third-party APIs get their own nightly tier so someone else's outage cannot block a merge. And evaluation metrics are a *test tier* with committed thresholds — a precision drop fails the build exactly like a unit test.

## The big picture

Split by **ownership**, not by convenience:

```
 tier         runs against                    mocks       when              location
 ─────────────────────────────────────────────────────────────────────────────────────────
 unit         nothing external                ALLOWED     every commit      *.test.ts (colocated)
 integration  real libSQL, real HTTP, files   forbidden   every commit      tests/integration/*.int.test.ts
 contract     live third-party APIs           forbidden   nightly           tests/contract/*.contract.test.ts
 e2e          running app + real DB           forbidden   every PR          tests/e2e/*.spec.ts
 eval         real corpus, labelled data      forbidden   nightly           evals/*.eval.test.ts
```

All five are Vitest *projects* in one config — [`vitest.config.ts:16-58`](../vitest.config.ts#L16-L58) — except E2E, which is Playwright. That is why the scripts are `vitest run --project unit`, `--project integration`, and so on.

## The cycle these tiers serve

Everything starts with Red → Green → Refactor, one behaviour at a time:

- **Red.** Write one failing test. Run it. Confirm it fails *for the reason you expect* — not a typo or a missing import.
- **Green.** The least code that passes. Hardcoding a return value is legitimate here; the next test forces it out.
- **Refactor.** Tests green, now improve the design. *"This is where the architecture actually gets built — skipping it is how a codebase rots while every test stays green."*

**One failing test at a time.** A second one before the first passes goes on a TODO list instead.

The rule that gives this teeth: **watch it fail.** A test never seen red is not known to test anything. A test that passes the moment it is written has proven nothing about the code — only about itself.

## Tier 1 — unit

Fast (whole suite under 10 seconds), no fixtures from disk, no clock, no async in domain.

Mocks are allowed here **and only here** — and even here, prefer a hand-written fake:

> `InMemoryFunderRepository` is easier to read and harder to get wrong than five lines of `vi.mock`.

A fake is type-checked against the port; a mock is a string and a guess that survives a refactor it should have broken. `packages/application/src/testing/` holds the real ones: `InMemoryOrganizationRepository`, `FixedIdGenerator`.

Domain tests need no doubles at all, because domain has no dependencies to double:

```ts
// docs/testing.md:44-48 — the shape
it('reports full turnover when no grantee repeats', () => {
  const signals = computeTurnover([grantees(2023, ['a','b']), grantees(2024, ['c','d'])]);
  expect(signals.turnover).toBe(1);
});
```

Colocated as `<subject>.test.ts` next to the subject. Coverage floors: **domain 100% line / 95% branch**, application 95/90, infrastructure 80/70, view-models 90/85. Ratcheted upward, never lowered. The justification for domain's 100%:

> `domain` is 100% because it is pure and there is no excuse. If it is hard to cover, it has I/O in it and belongs one layer out.

That is coverage used as an *architecture* signal, not a quality metric.

## Tier 2 — integration, with a real database

**Real infrastructure, no exceptions.** The enabling helper is thirty lines:

```ts
// tests/support/fresh-database.ts:12-29
/**
 * A real libSQL database, created from the committed migrations and thrown away afterwards.
 * Integration tests use real infrastructure -- no mocks, no in-memory substitute for SQL
 * (docs/decisions/0002). One database per test file keeps them independent under parallelism.
 */
export const freshDatabase = async (): Promise<FreshDatabase> => {
  const directory = mkdtempSync(join(tmpdir(), 'merit-test-'));
  const url = `file:${join(directory, 'merit.db')}`;
  const db = createDatabase({ url });
  await migrate(db);                                    // ← the committed migrations
  return { db, url, destroy: async () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
};
```

Two things it buys beyond "the SQL runs":

- **The migrations are tested on every integration run**, because that is how the schema gets built. A migration that does not apply cleanly to an empty database fails the whole suite.
- **`file:` libSQL, not `:memory:`.** An in-memory substitute is a different engine path; a temp file is the real thing and costs milliseconds.

What this tier exists to catch: joins and aggregates are actually correct, row-to-domain mapping works, transactions roll back cleanly, **re-running an ingest is genuinely a no-op**, and a checkpointed run killed mid-way resumes without loss or duplication. That last one is not optional:

```ts
// docs/testing.md:76-85
it('resumes from checkpoint without duplicating records', async () => {
  const db = await freshDatabase();
  await ingestBundle(db, fixtureBundle, { stopAfter: 500 });
  const partial = await countGrants(db);
  await ingestBundle(db, fixtureBundle);            // resume
  expect(await countGrants(db)).toBe(FIXTURE_TOTAL);
  expect(partial).toBeLessThan(FIXTURE_TOTAL);
});
```

The `expect(partial).toBeLessThan(…)` assertion is the subtle one — it proves the *first* run really did stop early, so the test cannot silently degrade into "ran twice, still fine".

**Fixtures are real data, trimmed.** A 200-filing slice cut from an actual IRS bundle, committed. Never hand-written XML — *"hand-written XML tests the schema you imagined, not the one the IRS files."*

One config note: integration runs `pool: 'forks'` in a single process because *"each integration test file creates its own real libSQL file; running them in one process keeps temp-file cleanup deterministic"* ([`vitest.config.ts:34-36`](../vitest.config.ts#L34-L36)).

## Tier 3 — contract, and why it exists (ADR-0002)

Here is the tension [ADR-0002](../docs/decisions/0002-integration-tests-use-real-infrastructure.md) resolves. "Never mock in integration tests" is right — but Merit depends on four APIs it does not control, and *the IRS server is already known to drop SSL connections mid-transfer*. If every commit calls them, an outage anywhere blocks every merge.

The tempting fix — mock the HTTP client — is **worse than the problem**:

> it means the code is only ever tested against the schema we imagined, and we discover the real one has drifted in production.

So the split is by ownership:

- **Integration** tests everything we control, with real infrastructure and fixtures cut from genuine responses.
- **Contract** tests call the live APIs, assert the fields we depend on still have the shapes we expect, and **regenerate those fixtures**. Nightly and on demand. A failure opens an issue: *the source changed, which is real news.*

The second clause is what keeps the whole scheme honest. Fixtures normally rot into fiction; here the tier that generates them re-runs every night. Accepted cost: a one-day worst-case window between an upstream schema change and knowing about it.

## Tier 4 — E2E

Playwright against the running app and a seeded database. One per slice, covering the path a real user takes. *"Keep the count low and the value high"* — E2E is the slowest and most brittle tier, and exists to prove the slice is **wired together**, not to enumerate cases.

S0's spec is the model. Four tests, and note what they cover:

```ts
// tests/e2e/s0-organization-profile.spec.ts:3-6
/**
 * S0's acceptance criterion, executable: create a profile in the UI, reload, see it.
 * One trivial feature travelling every layer proves the architecture before real logic lands.
 */
```

1. Create → reload → still there (the happy path *plus* durability)
2. Duplicate EIN → a human-readable message
3. Invalid state code → explains the field
4. Missing profile → says so plainly

**Three of four are failure modes.** That ratio is the point — `docs/testing.md` rule 8: *"Failure modes are not optional."*

The assertions are also worth reading as documentation: `$655,738` revenue → `$3,279` materiality floor, `B60` → `Education (B60)`, `NC` → `NC, GA, SC, TN, VA`. Real domain arithmetic asserted end to end, and locators are `getByLabel` / `getByRole` / `getByTestId` — accessible selectors, so the test breaks if the form stops being labelled.

## Tier 5 — eval, the unusual one (ADR-0003)

```
> Entity resolution can degrade from 94% precision to 71% without a single test turning red,
> and every downstream feature -- peer sets, funder signals, prospect scores -- silently
> degrades with it.
```

Merit's output is *recommendations*, and no unit test can assert a recommendation is good. So `evals/` is a test tier, not a research folder:

- Each metric has a threshold committed in `evals/thresholds.json`.
- Runs write to the `eval_runs` table with the commit SHA — [`0002-create-giving-graph.sql:98-106`](../packages/infrastructure/src/persistence/migrations/0002-create-giving-graph.sql#L98-L106).
- **A metric below its threshold fails the build, exactly like a unit test.**
- Thresholds ratchet upward and are never lowered without an ADR.

| Metric | Dataset | Gate |
|---|---|---|
| Resolution precision / recall | Schedule I withheld-EIN labels | Committed threshold |
| Resolution distribution shift | Hand-labelled 990-PF sample | Reported every run |
| Held-out funder recovery | Organisations already in the graph | Committed threshold |
| Rubric extraction | Manually transcribed rubrics | Criteria recall + point-total match |
| Critique calibration | Human-scored drafts | Correlation floor |
| Ingestion integrity | Reconciliation divergence rate | Ceiling |

The clause worth remembering from ADR-0003: *"A number nobody is accountable to is a number that drifts."*

## The ten rules

From [docs/testing.md](../docs/testing.md), compressed:

1. Write the test first — including for bugs: reproduce, then fix.
2. **Watch it fail.**
3. One behaviour per test; the name states the behaviour.
4. No mocks outside unit tests; prefer fakes even there.
5. **No conditionals in tests** — an `if` in a test means it is really two tests.
6. Deterministic: inject the clock, seed randomness, never depend on wall time or ordering.
7. No `.skip`, no `.only` — CI greps for them ([`tools/no-skipped-tests.mjs`](../tools/no-skipped-tests.mjs)).
8. Failure modes are not optional: empty result, malformed payload, quota exhausted, dropped connection, duplicate delivery, unknown schema version.
9. Test behaviour, not implementation — asserting a private method was called breaks on every refactor and catches no bugs.
10. Fix flakes immediately. *"A quarantined flaky test is a disabled test with extra steps."*

## Why it mattered here

Merit's own failure history is the argument. The validation run reported **0 grants for entire bundles** because Deflate64 entries were silently skipped. No test was red. The corpus looked processed. That class of bug — where a wrong answer is indistinguishable from a right one — is only caught by tests that run against real data, real files, and real schemas, plus metrics with thresholds someone is accountable to.

## Applied in this project

- [`vitest.config.ts`](../vitest.config.ts) — the five projects and their timeouts
- [`tests/support/fresh-database.ts`](../tests/support/fresh-database.ts) — the integration enabler
- [`tests/integration/`](../tests/integration/) — bundle download, zip stream, ingest, organization repository
- [`tests/e2e/s0-organization-profile.spec.ts`](../tests/e2e/s0-organization-profile.spec.ts) — S0's criteria, executable
- [`ADR-0002`](../docs/decisions/0002-integration-tests-use-real-infrastructure.md) · [`ADR-0003`](../docs/decisions/0003-evaluation-is-a-test-tier.md)
- [`docs/testing.md`](../docs/testing.md) — the full policy

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Mock the DB in integration tests | Tests the SQL you imagined. The entire point of the tier is gone |
| Live third-party APIs on every commit | Flaky by construction; couples the merge queue to someone else's uptime |
| VCR-style recorded cassettes everywhere | Same rot risk as fixtures, more machinery, less transparency |
| Report eval metrics without gating | *"A number nobody is accountable to is a number that drifts"* |
| More E2E coverage | Slowest, most brittle tier — it proves wiring, not cases |

**Accepted costs:** two suites of third-party knowledge to maintain; eval runs are slow enough to be nightly, so a regression can sit for up to a day; integration tests are seconds not milliseconds.

## Learn more

- [Vitest — Test Projects](https://vitest.dev/guide/projects) — the multi-tier config used here
- [Playwright — Best Practices](https://playwright.dev/docs/best-practices) — including why role/label locators beat CSS
- [Martin Fowler — Test Double](https://martinfowler.com/bliki/TestDouble.html) — fake vs mock vs stub
- [Kent Beck — Test-Driven Development by Example](https://www.oreilly.com/library/view/test-driven-development/0321146530/) — the Red/Green/Refactor source
- [Turso / libSQL docs](https://docs.turso.tech/) — the database `freshDatabase()` spins up
