# Testing

Integration tests are first-class citizens here. They are written before or alongside the
feature, never after.

---

## The cycle, concretely

**Red.** Write one failing test. Run it. Read the failure message and confirm it fails
*for the reason you expect* — not because of a typo or a missing import.

**Green.** Write the least code that passes. Hardcoding a return value is legitimate here;
the next test will force it out.

**Refactor.** Tests green, now improve the design. Extract the domain type. Name the concept.
Remove the duplication. This is where the architecture actually gets built — skipping it
is how a codebase rots while every test stays green.

**One failing test at a time.** If you find yourself writing a second before the first passes,
stop and note it as a TODO in your working list instead.

---

## The five tiers

| Tier | Runs against | Mocks | Location | When |
|---|---|---|---|---|
| **Unit** | Nothing external | Allowed | Colocated `*.test.ts` | Every commit |
| **Integration** | Real libSQL, real HTTP server, real files | **Forbidden** | `tests/integration/*.int.test.ts` | Every commit |
| **Contract** | Live third-party APIs | Forbidden | `tests/contract/*.contract.test.ts` | Nightly + on demand |
| **E2E** | Running app + seeded real DB | Forbidden | `tests/e2e/*.spec.ts` | Every PR |
| **Eval** | Real corpus, labelled data | Forbidden | `evals/` | Nightly + before release |

### Unit

Pure functions and orchestration logic. Fast — the whole suite under 10 seconds.

Mocks are allowed here **and only here**, and even here prefer a hand-written fake over a
mocking framework. `InMemoryFunderRepository` is easier to read and harder to get wrong than
five lines of `vi.mock`.

```ts
// domain — no test doubles needed at all
it('reports full turnover when no grantee repeats', () => {
  const signals = computeTurnover([grantees(2023, ['a', 'b']), grantees(2024, ['c', 'd'])]);
  expect(signals.turnover).toBe(1);
});

// application — hand-written fakes
it('excludes funders below the materiality floor', async () => {
  const repo = new InMemoryFunderRepository([tinyFunder, seriousFunder]);
  const result = await new ScoreProspects(repo, fixedClock).execute({ orgId, revenue: 655_738 });
  expect(result.value.map(p => p.funderId)).toEqual([seriousFunder.id]);
});
```

### Integration

**Real infrastructure, no exceptions.** A real libSQL database created per test file from the
committed migrations, torn down after. Real HTTP calls to our own routes. Real ZIP and XML files
on disk.

What integration tests are for:

- The SQL is actually correct — joins, aggregates, indexes, and the row-to-domain mapping
- Migrations apply cleanly to an empty database
- Transactions roll back on failure and leave nothing behind
- Repeating an ingest is genuinely a no-op
- A checkpointed run killed mid-way resumes without loss or duplication

That last one is not optional. The IRS server drops connections mid-transfer — it already has,
in the live validation run. Resumption is a headline behaviour of this system, so it gets a test
that kills the worker and restarts it.

```ts
it('resumes from checkpoint without duplicating records', async () => {
  const db = await freshDatabase();                 // real libSQL, real migrations
  await ingestBundle(db, fixtureBundle, { stopAfter: 500 });
  const partial = await countGrants(db);
  await ingestBundle(db, fixtureBundle);            // resume
  expect(await countGrants(db)).toBe(FIXTURE_TOTAL);
  expect(partial).toBeLessThan(FIXTURE_TOTAL);
});
```

**Fixtures are real data, trimmed.** A 200-filing slice cut from an actual IRS bundle, committed
under `tests/fixtures/`. Never hand-written XML — hand-written XML tests the schema you imagined,
not the one the IRS files.

### Contract

Integration tests must not depend on someone else's uptime, but the schemas we parse are not ours
and they drift. So third-party reality gets its own tier:

- Calls the **live** IRS, Grants.gov, USASpending, and ProPublica endpoints
- Asserts the fields we depend on still exist with the shapes we expect
- **Regenerates the fixtures** that integration tests use
- Runs nightly and on demand, not on every commit — an external outage must not block a merge
- A contract failure opens an issue automatically. It is real news: the source changed.

Gemini, Calendar, and Gmail have contract tests too, gated on credentials being present.

### E2E

Playwright, against the running app and a seeded database. One per slice, covering the path a
real user takes. These are the acceptance criteria in [roadmap.md](roadmap.md), executable.

Keep the count low and the value high. E2E tests are the slowest and most brittle tier;
they exist to prove the slice is wired together, not to enumerate cases.

### Eval

This project makes claims that must be measured, not asserted. The eval harness implements
[Merit.md](../Merit.md) §12 and is treated as a test suite:

| Metric | Dataset | Gate |
|---|---|---|
| Entity resolution precision / recall | Schedule I withheld-EIN labels | Committed threshold, regression fails |
| Resolution distribution shift | Hand-labelled 990-PF sample | Reported every run |
| Held-out funder recovery | Organisations already in the graph | Committed threshold |
| Fit-score agreement | Golden profile × opportunity pairs | Committed threshold |
| Rubric extraction | Manually transcribed rubrics | Criteria recall + point-total match |
| Critique calibration | Human-scored drafts | Correlation floor |
| Ingestion integrity | Reconciliation divergence rate | Ceiling |

Evals run against the real corpus, which is not committed — it is reproducible with
`pnpm worker ingest && pnpm worker load-bmf && pnpm worker resolve`
(ADR 0008).

Thresholds live in `evals/thresholds.json` and are committed. Results go to `eval_runs` with the
commit SHA. **A metric that drops below its threshold fails the build** exactly like a unit test.

The linker's own thresholds are fitted rather than chosen: `pnpm eval:fit` sweeps the grid
against the withheld-EIN labels, selects on one half of the sample, verifies on the other, and
commits the curve to `evals/link-threshold-curve.json`. A refit changes what the graph should
contain, so it is followed by `pnpm worker resolve --reset`
(ADR 0009).

---

## Rules

1. **Write the test first.** Every time. Including for bugs — reproduce, then fix.
2. **Watch it fail.** A test never seen red is not known to test anything.
3. **One behaviour per test.** The name states the behaviour: `it('routes uncertain matches to review instead of guessing')`.
4. **No mocks outside unit tests.** Prefer fakes to mocking frameworks even inside them.
5. **No conditionals in tests.** An `if` in a test means it is really two tests.
6. **Tests are deterministic.** Inject the clock, seed the randomness, never depend on wall time, ordering, or network weather.
7. **No `.skip`, no `.only`.** CI fails on both. A test that cannot pass gets deleted or fixed.
8. **Failure modes are not optional.** Empty result, malformed payload, quota exhausted, connection dropped mid-stream, duplicate delivery, unknown schema version. These are the cases this system actually meets.
9. **Test behaviour, not implementation.** Asserting a private method was called is a test that breaks on every refactor and catches no bugs.
10. **Fix flakes immediately.** A quarantined flaky test is a disabled test with extra steps.

---

## Coverage

Coverage is a floor, not a goal. Thresholds by package, ratcheted upward and never lowered:

| Package | Line | Branch |
|---|---|---|
| `domain` | 100% | 95% |
| `application` | 95% | 90% |
| `infrastructure` | 80% | 70% |
| `apps/web` (view-models) | 90% | 85% |

`domain` is 100% because it is pure and there is no excuse. If it is hard to cover, it has I/O
in it and belongs one layer out.

---

## Commands

```bash
pnpm test              # unit — fast, run constantly while working
pnpm test:watch        # the TDD loop
pnpm test:int          # integration — real database
pnpm test:contract     # live third-party APIs
pnpm test:e2e          # Playwright
pnpm eval              # the measurement harness
pnpm gate              # everything CI runs: types, lint, boundaries, unit, integration
```
