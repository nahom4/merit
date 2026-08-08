# 18 — S5: competitive positioning, and the denominator that does not exist

**Status: Designed.** Sources: [Merit.md §9 "Federal positioning"](../submission_docs/Merit.md),
[roadmap S5](../docs/roadmap.md).

**TL;DR:** Every federal opportunity carries a program number, and USASpending holds every award
ever made under that number. Joining them gives a cohort of past winners — sizes, award amounts,
repeat concentration, trend. What it cannot give is a win probability, because **public data
records who won and never who applied and lost**. Merit reports a *competitive base rate* and says
in the interface that this is what it is. This is the smallest slice in the roadmap and the one
with the sharpest intellectual honesty requirement.

## The big picture

```
  opportunity.cfdaList[0]        ← the federal program number, from S3's ingestion
          │
          │  same number
          ▼
  POST usaspending.gov/api/v2/search/spending_by_award/
          │
          ▼
   every award ever made under this program
          │
          ▼  arithmetic, no model
   ┌──────────────────────────────────────────────────┐
   │ recipient size distribution                       │
   │ median award vs advertised ceiling                │
   │ awards per cycle                                  │
   │ repeat-recipient concentration                    │
   │ trend over time                                   │
   └──────────────────────────────────────────────────┘
          │
          ▼
   competitive base rate + the caveat, inline
   + the award history table, so the user can check the call
```

The join key is the one field S3 must not lose. Merit.md's appendix verified it end to end:
announcement `HHS-2026-ACF-ACYF-YY-0119` carries `cfdaList: ["93.647"]`, and filtering USASpending
on `93.647` returns real awards to Morehouse School of Medicine ($8.9M), Child Trends ($5.6M),
UMass Lowell ($3.75M), and South Central Workforce Development Council ($3.0M).

## Why this is worth a slice

That last row is the whole argument. A program funding both major research universities *and* a
regional workforce council is materially more approachable than one whose entire history is
universities — and **that is invisible in the announcement and obvious in the award data**. The
announcement says "$500,000 ceiling, 14 expected awards". It does not say who has ever won.

For a $600k organisation, this is the difference between a realistic pursuit and six weeks spent
on an application that was never winnable — the exact failure Merit.md §1 opens with.

## The rule: never a win probability

From CLAUDE.md's product rules, restated in Merit.md §9:

> Public data records who won. It never records who applied and lost, so there is no denominator
> anywhere in it, and a number called "win probability" would be fabricated.

Three consequences an implementation must respect:

1. **The name is "competitive base rate"**, defined as how organisations of this size and type have
   historically fared under this program. Not a probability, not a percentage chance, not "odds".
2. **The caveat renders inline**, not in a footnote or tooltip. The roadmap says *"rendered inline
   in the UI, not buried"*. ADR 0010's reasoning about citations applies here too: a caveat that is
   hidden is, in practice, absent.
3. **The award history table is shown** so the user can check the call rather than trust it. Same
   principle as S1's expandable grantee rows.

Note that S2's brief already carries a version of this limitation on every funder brief — *"public
filings name who was funded. They never name who applied and was declined, so nothing here can tell
you your chances"* ([`funder-brief.ts:232-233`](../packages/domain/src/funder/funder-brief.ts#L232-L233)).
S5 is the same epistemics applied to federal money. If an agent writes a probability here, it has
contradicted code that already exists.

## What the cohort statistics actually say

| Statistic | The question it answers |
|---|---|
| Recipient size distribution | Has anyone our size ever won this? |
| Median award vs advertised ceiling | Is the ceiling real, or is everyone funded at a third of it? |
| Awards per cycle | Fourteen awards or two? |
| Repeat-recipient concentration | Is this an open competition or a renewal in disguise? |
| Trend | Is the program growing, shrinking, or ending? |

Repeat concentration should reuse the Herfindahl index already implemented for funder
concentration in [`funder-signals.ts`](../packages/domain/src/funder/funder-signals.ts) (note 09) —
same statistic, same interpretation, and reusing it keeps the two screens speaking the same
language. Size distribution should use the same 0.5×–4× revenue band that defines a peer in S1 and
S2, for the same reason.

## Where the code goes

- `domain/positioning/` — cohort statistics and the base rate. Pure arithmetic over award rows,
  unit-testable with no network. Like S1's signals, **none of this is model output.**
- `application/use-cases/build-positioning/` — orchestration, plus a `coverage` block (how many
  awards were found, over what years).
- `infrastructure/usaspending/` — the HTTP gateway, a Zod schema at the boundary, a contract test.
- `apps/web` — a panel on the federal board, not its own screen.

**Degradability question to settle early:** is USASpending like ProPublica — supplementary, allowed
to fail, absence stated ([ADR 0011](../docs/decisions/0011-propublica-is-a-degradable-dependency.md)) —
or is positioning load-bearing enough that the panel must retry? The precedent points at
degradable, and following it costs one `financialsError`-shaped field.

## How to verify an agent's S5 work

1. **A contract test against live USASpending** filtered on a known program number, asserting
   recipient, amount, and date fields exist. The API is real and free; there is no excuse for a
   mock here (CLAUDE.md tier table).
2. **Unit tests for each cohort statistic**, including the empty and single-award cases. One award
   is not a trend, and the code must say `unknown` rather than compute one — the same null-means-
   unknown discipline as [`financial-trend.ts:69`](../packages/domain/src/funder/financial-trend.ts#L69).
3. **A grep for "probability", "chance", "odds", "likelihood"** across the slice's UI strings. This
   sounds glib; it is the fastest check that exists for the rule that matters most here.
4. **An E2E asserting the caveat text is present in the rendered panel**, not merely available —
   S2's E2E asserts citations the same way, rather than trusting inspection.
5. **A test that a program with no matching awards renders an honest empty state**, not a zero.

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Estimate applicant counts to get a denominator | Fabrication. No public source records losing applicants |
| Call it a win rate "for simplicity" | Explicitly forbidden; also the claim a user is most likely to repeat to a board |
| Model-generated positioning narrative | Arithmetic is auditable and free. Same reasoning as ADR 0010 |
| Hide low-award-count programs | Coverage is stated, never implied. Say "3 awards found" |

## Learn more

- [Merit.md §9 — Federal positioning](../submission_docs/Merit.md), and the USASpending appendix entry
- [USASpending API — `spending_by_award`](https://api.usaspending.gov/docs/endpoints) — the endpoint verified in the appendix
- [Base rate](https://en.wikipedia.org/wiki/Base_rate) — what is being reported, and why it is not a probability
- [Survivorship bias](https://en.wikipedia.org/wiki/Survivorship_bias) — the exact failure a "win rate" from winners-only data would commit
