# 09 — Funder Signals and the Prospect Score

**TL;DR:** Once the giving graph exists, everything the product claims is arithmetic over it — no model output anywhere. Turnover says whether a newcomer can get in; four separately-reported components say whether *this* funder fits *this* nonprofit; and a null component means "unknown", which is carefully not the same as zero.

## The big picture

This is the product, in one path:

```
 organisation profile (NTEE B60, $656k, NC)
        │
        ▼  findPeers            same NTEE major group, 0.5×–4× revenue, actually funded by someone
   peer organisations
        │
        ▼  findCandidateFunders every funder of every peer  (capped at 400, reported as coverage)
   candidate funders
        │
        ▼  loadFunderHistories  every grant each one ever made
   grant history
        │
        ▼  computeFunderSignals    ← domain, pure arithmetic
   turnover · newGranteeShare · concentration · askP50 · firstTimeAskP50 · retention · stateShares
        │
        ▼  computeProspectScore    ← domain, pure arithmetic
   openness · affinity · geographyFit · sizeFit  +  isCredible / credibilityReason
        │
        ▼  filter credible, sort regional-first
   the prospect list
```

Orchestrated by [`score-prospects.use-case.ts`](../packages/application/src/use-cases/score-prospects/score-prospects.use-case.ts); every computation is in `packages/domain`.

## Part 1 — funder signals

```ts
// packages/domain/src/funder/funder-signals.ts:1-5
/**
 * A funder's behavioural profile, computed as arithmetic over its own filing history.
 * None of this is model output, and none of it is something a foundation publishes about
 * itself -- which is exactly why it is worth computing.
 */
```

| Signal | Definition | What it answers |
|---|---|---|
| `turnover` | Share of last year's grantees absent this year, averaged | Does a seat open up? |
| `newGranteesPerYear` / `newGranteeShare` | First-time grantees added | Does a stranger take it? |
| `concentration` | Herfindahl index over grant amounts | Is one grantee the whole budget? |
| `askP50` / `askP90` | Grant amount percentiles | What size does it write? |
| `firstTimeAskP50` | Median **first** grant to a new grantee | What would *we* get? |
| `retentionYearsP50` | Median longest consecutive-year run | Is this a one-off or a relationship? |
| `stateShares` | Share of grants by recipient state | Does it give near us? |

### Six details worth stealing

**1. Turnover and new-grantee rate are different questions.**

```ts
// funder-signals.ts:91-93
// Turnover is departures -- last year's grantees who are gone this year. The new-grantee
// rate is arrivals. They are different questions: a foundation can add five newcomers
// while keeping everyone it had, and one that drops half its list has a seat free.
const departed = [...previous].filter((key) => !current.has(key)).length;
const fresh    = [...current].filter((key) => !previous.has(key)).length;
```

Collapsing them into one "churn" number would hide a growing foundation behind a stable one.

**2. Left-censoring is handled explicitly.** A grantee whose first observed year is the *first year of the corpus* may have been funded for a decade before that — its earliest grant is not a first grant:

```ts
// funder-signals.ts:108-120 (abridged)
// A grantee whose first year on file is the first year of the corpus may have been funded
// for a decade before it -- its earliest observed grant is not necessarily a first grant.
// Where genuinely new grantees exist, use only those.
const uncensoredFirstGrants = grants.filter((g) => firstYearOf.get(g.granteeKey) === g.taxYear && g.taxYear !== years[0]);
const firstGrantAmounts = (uncensoredFirstGrants.length > 0 ? uncensoredFirstGrants : observedFirstGrants).sort(…);
```

This is a real survival-analysis concern handled in twelve lines, with a documented fallback when the clean subset is empty. `firstTimeAskP50` is the number a nonprofit will actually act on, so getting it systematically wrong would be expensive.

**3. Percentiles use nearest-rank, no interpolation.**

```ts
// funder-signals.ts:57-58
/** Nearest-rank percentile. No interpolation: grant amounts are real observed values, and a
 *  median of $10,000 is a statement about a grant that was actually made. */
```

An interpolated $47,312.50 is a number no foundation ever wrote a cheque for. When a statistic will be read as a fact about the world, prefer the estimator that stays inside the observed values.

**4. Null means unknown, and unknown is not zero.** `turnover` is `null` with only one year on file — *"unknown, not open"*. This propagates all the way to the UI, which renders "not enough filings" rather than 0%.

**5. `granteeKey` is a resolved entity id where resolution succeeded, and a normalised name otherwise** ([lines 7-8](../packages/domain/src/funder/funder-signals.ts#L7-L8)). Graceful degradation: turnover for a funder whose recipients did not resolve is still approximately right, computed on normalised names.

**6. Retention is the longest *consecutive* run**, not the count of years — [`longestRuns`](../packages/domain/src/funder/funder-signals.ts#L154-L175). Funded in 2019, 2020, 2023 is a two-year relationship and a re-approach, not a three-year one.

## Part 2 — the prospect score

```ts
// packages/domain/src/prospect/prospect-score.ts:3-8
/**
 * The four score components, always separate. A development director has to defend a
 * prospect list to a board, and "the model said so" is not a defence -- so there is no
 * single opaque number here, only a transparent weighted sum of four values that are each
 * traceable to grantee rows.
 */
```

Weights, with the reasoning attached:

```ts
// prospect-score.ts:44-53
/**
 * Turnover carries the most weight: it is the closest available proxy for whether a newcomer
 * can get in, and it is not something a funder publishes about itself (Merit.md section 8).
 */
export const COMPONENT_WEIGHTS = {
  openness: 0.35, affinity: 0.3, geographyFit: 0.2, sizeFit: 0.15,
} as const;
```

### Openness — churn, discounted by concentration

```ts
// prospect-score.ts:69-73
// Turnover says a seat opens up; new-grantee share says a stranger takes it. Concentration
// discounts both: a foundation whose budget is one grantee has no room regardless.
const churn  = 0.6 * signals.turnover + 0.4 * signals.newGranteeShare;
const spread = signals.concentration === null ? 1 : 1 - signals.concentration;
return clamp(churn * (0.6 + 0.4 * spread));
```

Note the discount is bounded — multiplying by `0.6 + 0.4 × spread` keeps a concentrated funder at ≥60% of its churn score rather than zeroing it. Concentration is a discount, not a veto.

### Affinity — two independent kinds of evidence

```ts
// prospect-score.ts:76-82
const peerSignal    = clamp(input.peerGranteeCount / PEER_SATURATION);   // PEER_SATURATION = 5
const programSignal = clamp(input.sameProgramGranteeShare);
// Peers are direct evidence; program share is the wider pattern. Both must be zero for
// affinity to be zero, and either alone is worth something.
return clamp(0.6 * peerSignal + 0.4 * programSignal);
```

`PEER_SATURATION = 5` — *"beyond this many peer grantees, more peers do not tell us anything new."* Diminishing returns made explicit rather than letting a funder with 40 peer grantees dominate the ranking.

### Geography — a state line is not a wall

```ts
// prospect-score.ts:88-94
const home = shares[input.organizationState] ?? 0;
let neighbouring = 0;   // sum of shares in the organisation's region
…
// A funder across a state line is a live prospect; one across the country usually is not.
return clamp(home + 0.6 * neighbouring);
```

Neighbouring states count at 60%. The region comes from [`UsState.region()`](../packages/domain/src/organization/us-state.ts) — for NC that is `GA, SC, TN, VA` (verified in the E2E test's expected output, [`s0-organization-profile.spec.ts:29`](../tests/e2e/s0-organization-profile.spec.ts#L29)).

### Size fit — a band, then a decay

```ts
// prospect-score.ts:97-111 (abridged)
const typical = signals.firstTimeAskP50 ?? signals.askP50;   // prefer what a newcomer gets
if (typical < materialityFloorCents) return 0;

// The band a first ask realistically sits in: above the floor, and no larger than the
// organisation's own annual revenue. A grant bigger than everything the organisation
// raises in a year goes to somebody else.
const ceiling = Math.max(materialityFloorCents * 4, organizationRevenueCents);
if (typical <= ceiling) return 1;

// Beyond the ceiling, decay rather than cliff-edge: a somewhat-too-large funder is a worse
// prospect, not an impossible one.
return clamp(ceiling / typical);
```

`firstTimeAskP50 ?? askP50` is the right preference: what a *newcomer* receives, falling back to the overall median. And `1/x` decay beyond the ceiling avoids the pathology where a funder one dollar over the line scores identically to one a hundred times over.

### The most important line: redistributing unknown weight

```ts
// prospect-score.ts:130-139
// An unknown component does not score zero -- that would rank a funder with one year of
// filings below one we know to be closed. Its weight is redistributed across what is known.
for (const [name, value] of Object.entries(components)) {
  const weight = COMPONENT_WEIGHTS[name as keyof typeof COMPONENT_WEIGHTS];
  if (value === null) continue;
  weighted += weight * value;
  weightAvailable += weight;
}
…
total: weightAvailable === 0 ? 0 : weighted / weightAvailable,
```

Dividing by *available* weight rather than 1.0 is the whole trick. Treating missing data as zero is the most common quiet bug in scoring systems, and here it would have an absurd consequence: a promising foundation with one year of filings would rank below a foundation we have positively established is closed to newcomers.

### Credibility is a separate axis from score

```ts
// prospect-score.ts:113-120
const credibilityOf = (input: ProspectInput): CredibilityReason => {
  if (median < materialityFloorCents) return 'below_materiality_floor';
  if (median > SIZE_CEILING_CENTS)    return 'above_size_ceiling';    // $500,000
  // The bar from the validation run: two or more peer grantees, or one in region.
  if (peerGranteeCount >= 2 || regionalGranteeCount >= 1) return 'credible';
  return 'too_few_grantees_in_common';
};
```

A high score with weak evidence is not a prospect. And the *reason* is a typed union, not a boolean — so a filtered-out funder can always be explained.

### The materiality floor

```ts
// packages/domain/src/prospect/materiality-floor.ts:4-24 (abridged)
/** 0.5% of revenue -- below this a grant is not worth the hours an application costs.
 *  Validated against three real organisations in validation/RESULTS.txt. */
export const MATERIALITY_FLOOR_RATE = 0.005;

/** The floor under the floor. For a very small organisation the percentage would admit
 *  $500 grants, which are not worth an application to anyone. */
export const MATERIALITY_FLOOR_MINIMUM_DOLLARS = 2_500;
```

*"Which is why a family foundation counted for the $656k literacy council is noise for the $4.5M club."* One relative threshold with an absolute floor makes the same code correct across a 7× revenue range — and both numbers cite where they came from, as `docs/conventions.md` requires of every non-obvious constant.

## Part 3 — the orchestration, and its honesty about limits

Three constants in the use case, each reported rather than hidden:

```ts
// score-prospects.use-case.ts:47-60 (abridged)
/**
 * Peer revenue band. A $656k literacy council and a $40M university are not comparable, and
 * the funders that serve them do not overlap. Half to four times revenue is wide enough to
 * find peers for a small organisation and narrow enough to keep the set meaningful.
 */
const PEER_REVENUE_LOWER = 0.5;
const PEER_REVENUE_UPPER = 4;

/**
 * Signals are computed from a funder's full grant history, so the candidate set is capped.
 * The cap is reported as coverage rather than hidden: the user is told how many funders
 * were considered.
 */
const MAX_CANDIDATE_FUNDERS = 400;
```

And the ranking:

```ts
// score-prospects.use-case.ts:132-134
// Regional funders first: a foundation twenty miles away is a better prospect than a
// national one with an identical score, and the validation run ranked the same way.
prospects: credible.sort(byRegionThenScore),
```

Region is a **lexicographic** tiebreak ahead of score, not a weight — a deliberate override of the numeric ranking, justified by the validation run.

The peer query itself carries a subtle but important choice ([`libsql-prospect.repository.ts:20-41`](../packages/infrastructure/src/persistence/libsql-prospect.repository.ts#L20-L41)): peers must have `EXISTS (… entity_links WHERE decision = 'linked')` — *"an entity nobody has ever funded tells us nothing about who might fund us."* Peers come from the graph, not the registry alone.

Finally, `coverage` is a first-class part of the return type:

```ts
// score-prospects.use-case.ts:34-44
/**
 * Coverage, stated rather than implied. "12 comparable organisations found" is a claim
 * the interface must make; silence would imply completeness we cannot promise.
 */
readonly coverage: { peersFound; candidateFundersConsidered; credibleFunders; materialityFloorCents };
```

## Why it mattered here

The product's central claim is *"here are foundations that would fund you, and none of them posted anything anywhere."* That claim is only defensible if a development director can open any number and see the grantee rows underneath it. Every design choice above — four components not one, typed credibility reasons, nulls that stay null, coverage in the payload — exists to make the list *defensible to a board*, not merely accurate.

## Applied in this project

- [`funder-signals.ts`](../packages/domain/src/funder/funder-signals.ts) + [`funder-signals.test.ts`](../packages/domain/src/funder/funder-signals.test.ts)
- [`prospect-score.ts`](../packages/domain/src/prospect/prospect-score.ts) + [`prospect-score.test.ts`](../packages/domain/src/prospect/prospect-score.test.ts)
- [`materiality-floor.ts`](../packages/domain/src/prospect/materiality-floor.ts) + its test
- [`score-prospects.use-case.ts`](../packages/application/src/use-cases/score-prospects/score-prospects.use-case.ts) — orchestration and coverage
- [`libsql-prospect.repository.ts`](../packages/infrastructure/src/persistence/libsql-prospect.repository.ts) — the peer and candidate SQL
- [`prospect-list/view-model.ts`](../apps/web/src/features/prospect-list/view-model.ts) — four bars, evidence rows, coverage sentence

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| An LLM scores each funder | Unexplainable, unreproducible, costs money per prospect, and cannot be defended to a board. Arithmetic over filings is auditable |
| A learned model over the four components | No labels yet. Slice S8 retunes *weights* from user accept/reject — which keeps the components legible |
| One composite score in the UI | Explicitly forbidden by the product rules in `CLAUDE.md` |
| Treat missing signals as zero | Would rank an unknown funder below a known-closed one |

**Weights are currently judgement, not fitted.** `COMPONENT_WEIGHTS` cites reasoning from `Merit.md` §8, and the credibility bar cites the validation run — but 0.35/0.3/0.2/0.15 is a considered guess. The roadmap's held-out funder recovery harness (S1) is what would turn it into a measured number, and S8 retunes per organisation from feedback. Worth being honest about when reading this code.

## Learn more

- [Wikipedia — Herfindahl–Hirschman index](https://en.wikipedia.org/wiki/Herfindahl%E2%80%93Hirschman_index) — the concentration measure
- [Wikipedia — Percentile (nearest-rank method)](https://en.wikipedia.org/wiki/Percentile#The_nearest-rank_method)
- [Wikipedia — Censoring (statistics)](https://en.wikipedia.org/wiki/Censoring_(statistics)) — why the first corpus year is treated differently
- [`validation/RESULTS.txt`](../validation/RESULTS.txt) — where the credibility bar and materiality floor came from
