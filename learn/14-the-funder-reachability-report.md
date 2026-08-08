# 14 — The funder reachability report: describing a funder without scoring it

**Status: Built** (S2). Every line reference below is real code.

**TL;DR:** S1 answers *"which funders?"* with four scores. S2 answers the next question — *"should
we bother with this one?"* — with description rather than score: grantee lists by year, an ask
calibrated from first grants, shared-funder proximity, a financial trend, and a brief in which
every sentence carries the filing it came from. The brief is **composed from rows, not generated
by a model**, which turns "every claim cites a source" from a policy into a structural guarantee.

## The big picture

One use case, five domain computations, one optional third-party call:

```
   funder EIN + organisation profile
              │
   ┌──────────┴───────────────────────────────────────────┐
   │  ReportFunderReachability.execute()                   │
   │                                                       │
   │  funders.findFunder(ein) ────────────────► profile     │
   │  funders.loadGranteeHistory(ein) ────────► grant rows  │
   │  prospects.findPeers(...) ───────────────► peers       │
   │  funders.findSharedFunderPaths(...) ─────► edges       │
   │  financials.fetchFinancials(ein) ────────► ProPublica  │ ← allowed to fail
   └──────────┬───────────────────────────────────────────┘
              │  all pure domain from here down
              ├─► computeReachability(grants)   years · ask distribution · geography · program mix
              ├─► calibrateAsk(...)             recommended first ask + the basis it rests on
              ├─► buildAffinityPaths(edges)     shared-funder proximity, labelled as such
              ├─► computeFinancialTrend(...)    rising / falling / steady / unknown
              └─► composeFunderBrief(...)       claims, each with citations + limitations
                        │
                  validateBrief()  ← throws if a claim has no citation. Composition bug, not user error
```

Orchestrated by
[`report-funder-reachability.use-case.ts`](../packages/application/src/use-cases/report-funder-reachability/report-funder-reachability.use-case.ts);
every computation lives in [`packages/domain/src/funder/`](../packages/domain/src/funder/).

## Part 1 — the brief is composed, not generated

This is the slice's central decision ([ADR 0010](../docs/decisions/0010-the-funder-brief-is-composed-not-generated.md)).
"Brief" sounds like a writing task, and writing is what language models are for. The ADR's
argument for not using one is worth internalising, because the same reasoning recurs in S4:

> A model asked to cite its sources produces text that *contains* citations; whether each claim is
> supported by the row it names is then something a validator has to check after the fact, and a
> validator that can check "this sentence is entailed by these rows" is a harder problem than the
> brief itself.

So each claim is a template filled from the aggregate that its citation names:

```ts
// funder-brief.ts:104-112
claims.push({
  id: 'giving',
  topic: 'giving',
  statement:
    `${funderName} made ${reachability.totalGrants} grants totalling ` +
    `${dollars(reachability.totalCents)} to ${reachability.distinctGrantees} …`,
  citations: [citeFilings(funderEin, input.grants)],
});
```

`citeFilings` carries the actual IRS object ids and tax years
([funder-brief.ts:80-85](../packages/domain/src/funder/funder-brief.ts#L80-L85)). A citation is a
**discriminated union** — `filings`, `registry`, `propublica` — because *"the three sources are
cited differently and a reader must be able to tell which one they are being shown"*
([:19-29](../packages/domain/src/funder/funder-brief.ts#L19-L29)).

Three details worth stealing:

**Money formatting is hand-rolled on purpose.**

```ts
// funder-brief.ts:67-70
/** `toLocaleString` varies with the host's ICU data, and a claim's wording must not depend on
 *  which machine composed it. */
```

**The limitations list is unconditional.** Three entries appear on *every* brief — the record says
what a funder has done and not what it will do; filings never name who applied and was declined,
so there is no denominator; Merit will not contact the funder
([:228-235](../packages/domain/src/funder/funder-brief.ts#L228-L235)). The rest are conditional on
the evidence's shape: one filing year, unmatched program areas, grants with no recipient state, a
suggested ask that had to fall back to renewals.

**The rule is checked, not trusted.** `validateBrief` returns `Result<FunderBrief, UncitedClaim>`,
and the use case *throws* on error:

```ts
// report-funder-reachability.use-case.ts:136-139
// Composition is supposed to make an uncited claim impossible. Checking anyway costs nothing …
// reaching the throw means composition has a bug, which is exactly what a throw is for.
const validated = validateBrief(brief);
if (!validated.ok) throw validated.error;
```

This is note 04's rule applied cleanly: an uncited claim is not an expected failure the user can
cause, so it is a throw, not an `err`.

## Part 2 — ask calibration: the number the user will actually act on

The funder's median grant is the wrong number. It is dominated by renewals to organisations
already inside. The right one is the median **first** grant to organisations of roughly this size
— two filters on the same rows, and both move the answer a long way.

The cascade of samples, narrowest first, with the fallback *recorded*:

```ts
// ask-calibration.ts:103-110
const [sample, basis] =
  inBand.length > 0        ? [inBand,       'first_grants_in_size_band']
: firstGrants.length > 0   ? [firstGrants,  'first_grants_any_size']
: input.grants.length > 0  ? [input.grants, 'all_grants']
:                            [[],           'no_evidence'];
```

`basis` is rendered beside the number, because *"a recommendation drawn from two grants to
organisations of a different size is a different claim from one drawn from forty in the right
band, and the interface must not flatten them"*
([:18-24](../packages/domain/src/funder/ask-calibration.ts#L18-L24)). Each weaker basis also adds
a sentence to the brief's limitations.

Two more:

- **Left-censoring again.** A grantee whose earliest grant sits in the earliest year on file may
  have been funded for a decade before the corpus opened, so that grant is *censored, not first*
  ([:58-78](../packages/domain/src/funder/ask-calibration.ts#L58-L78)). Same treatment as
  `computeFunderSignals` in note 09 — when the same statistical hazard appears twice, handle it
  the same way both times.
- **Bounded at both ends**, with each adjustment flagged: `wasRaisedToFloor` when the median sits
  below the materiality floor, `wasCappedAtRevenue` when it exceeds the organisation's own annual
  revenue ([:117-132](../packages/domain/src/funder/ask-calibration.ts#L117-L132)).

## Part 3 — affinity paths, and refusing to oversell them

`peer ← intermediary funder → this funder's grantee` is a path through the bipartite giving graph.
It is the closest thing to a warm introduction that public data supports, and it is *not* one. The
domain object carries its own honesty:

```ts
// affinity-path.ts:56-58
export const AFFINITY_PATH_DISCLAIMER =
  'This is shared-funder proximity computed from public filings: the same funders appear on ' +
  'both sides. It is not a personal connection, and it says nothing about who has met whom.';
```

Putting the label and disclaimer *in the value* rather than in the UI is the design point: the
product rule holds no matter which screen renders it. Strength saturates at three shared funders —
*"a fourth overlapping funder does not make the pattern meaningfully more real than the third
did"* ([:60-64](../packages/domain/src/funder/affinity-path.ts#L60-L64)).

## Part 4 — ProPublica as a degradable dependency

The first third-party call that happens **during a page render** — the IRS bundles are fetched
offline by a worker into a local database. [ADR 0011](../docs/decisions/0011-propublica-is-a-degradable-dependency.md)
makes it the one place in the codebase that absorbs a failure instead of returning it:

```ts
// report-funder-reachability.use-case.ts:109-113
// The one place a failure is absorbed rather than returned. ProPublica is supplementary:
// it enriches a report the IRS filings already support on their own.
const fetched = await this.financials.fetchFinancials(funderEin);
const financials = fetched.ok ? computeFinancialTrend(fetched.value) : null;
const financialsError = fetched.ok ? null : fetched.error.message;
```

Degrading is not the same as going quiet. `financials: null` means the brief makes no financial
claim (it cannot cite one) and the limitations gain a line saying the trend is missing.

The gateway's three rules are all instances of "no silent fallbacks"
([`propublica-financials.gateway.ts`](../packages/infrastructure/src/propublica/propublica-financials.gateway.ts)):

| Rule | Line | Why |
|---|---|---|
| A 404 is not retried; only 5xx and network errors are | [:72-82](../packages/infrastructure/src/propublica/propublica-financials.gateway.ts#L72-L82) | Having no record of an EIN is a fact, not a hiccup |
| An unrecognised `formtype` fails the whole fetch | [:99-113](../packages/infrastructure/src/propublica/propublica-financials.gateway.ts#L99-L113) | Skipping the year would quietly understate giving — the failure mode this project refuses |
| A 990 filer's `grantsPaidCents` is `null`, never `0` | [:121-123](../packages/infrastructure/src/propublica/propublica-financials.gateway.ts#L121-L123) | Those grants are on Schedule I. Zero would read as "gave nothing" |

Note also the timeout: 8 seconds, against 120 for bundle downloads. *A slow supplementary source
must not hold a page built from local data.*

## Part 5 — the E2E fixture limitation, stated rather than hidden

Worth reading [`docs/roadmap.md`'s S2 section](../docs/roadmap.md) closely. The committed E2E
bundle is one year of filings, so no funder in it appears in two tax years and exactly one entity
has more than one funder. Turnover-over-time and shared-funder proximity therefore **cannot** be
exercised end to end against it. Rather than fake the fixture or quietly drop the criteria, the
slice: asserts at E2E that those sections render honestly *including their empty states*, proves
the behaviours at the integration tier against a real libSQL database seeded with a multi-year
graph, and writes the gap into the roadmap.

That is the model for handling a test-tier gap here. Not "it's covered", not silence — a written
statement of what is covered where, and what would close it.

## Applied in this project

- [`funder-reachability.ts`](../packages/domain/src/funder/funder-reachability.ts) — years, ask distribution, geographic spread, program mix
- [`ask-calibration.ts`](../packages/domain/src/funder/ask-calibration.ts) · [`affinity-path.ts`](../packages/domain/src/funder/affinity-path.ts) · [`financial-trend.ts`](../packages/domain/src/funder/financial-trend.ts) · [`funder-brief.ts`](../packages/domain/src/funder/funder-brief.ts)
- [`report-funder-reachability.use-case.ts`](../packages/application/src/use-cases/report-funder-reachability/report-funder-reachability.use-case.ts) + its [integration test](../tests/integration/report-funder-reachability.int.test.ts)
- [`propublica-financials.gateway.ts`](../packages/infrastructure/src/propublica/propublica-financials.gateway.ts) + [contract test](../tests/contract/propublica.contract.test.ts)
- [`features/funder-reachability/`](../apps/web/src/features/funder-reachability/) — view-model plus six components
- [`tests/e2e/s2-funder-reachability.spec.ts`](../tests/e2e/s2-funder-reachability.spec.ts)

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Generate the brief with Gemini | Cannot structurally guarantee citations; introduces the LLM a slice before the orchestrator that makes model calls safe (ADR 0010) |
| Fail the page when ProPublica is down | Nine of ten sections need only local data (ADR 0011) |
| Median grant as the recommended ask | Dominated by renewals; overstates what a newcomer gets |
| Call affinity paths "connections" | False, and the product rules forbid it |

## Learn more

- [ADR 0010](../docs/decisions/0010-the-funder-brief-is-composed-not-generated.md) · [ADR 0011](../docs/decisions/0011-propublica-is-a-degradable-dependency.md)
- [Merit.md §9 — Prospect research](../submission_docs/Merit.md)
- [IRC §4942](https://www.law.cornell.edu/uscode/text/26/4942) — the ~5% minimum distribution behind `payoutRate`
- [ProPublica Nonprofit Explorer API](https://projects.propublica.org/nonprofits/api)
