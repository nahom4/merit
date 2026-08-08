# 17 — S4: rubric extraction, rubric-grounded drafting, and a critic that must cite

**Status: Designed.** Sources: [Merit.md §9 "Rubric-grounded drafting"](../submission_docs/Merit.md),
[roadmap S4](../docs/roadmap.md).

**TL;DR:** Federal announcements publish the exact rubric their reviewers score against, with point
values. S4 extracts it, drafts each section against the sub-criteria that section is scored on,
scores its own draft, and revises weighted by points available. The output is not prose — it is a
**marked-up draft that tells a development director where their remaining hours should go**. Two
rules carry the slice: a critique score without a cited sentence is rejected, and low extraction
confidence downgrades the whole feature loudly rather than inventing a rubric.

## The big picture

```
 opportunity (high fit, from S3)
        │
        ▼  attachment download  →  pdftotext -layout       ← deterministic, no model call
   94,174 characters of announcement text
        │
        ▼  EXTRACT RUBRIC        (model, schema-validated, confidence-scored)
   criteria[] · sub-criteria[] · point values · confidence
        │
        ├── confidence < threshold ──► fall back to summary-conditioned drafting
        │                              AND SAY SO on the screen
        ▼
   DRAFT each section conditioned on the sub-criteria it is scored against
        │
        ▼  CRITIQUE  per criterion, each score citing a supporting sentence
   scores before revision
        │
        ▼  REVISE   weakest sections first, weighted by points available
   scores after revision + "weak because a human must supply X"
        │
        ▼
   Draft studio: draft beside rubric, before/after scores, flagged gaps
```

The real rubric Merit.md quotes from a live announcement — 110 points across seven criteria, with
Response worth 40 and Purpose and Need worth 5 — is why weighting matters: *"a 40-point criterion
earns effort a 5-point criterion does not."*

## Part 1 — the PDF, and why extraction is deterministic

`pdftotext -layout` (poppler), not a model. The `-layout` flag preserves column structure, which is
what makes a points table readable at all. This is a straight application of the cascade from note
16: text extraction is solved by a tool, so no quota is spent on it.

The endpoint is verified in Merit.md's appendix: keyless, 345KB, extracting to 94,174 characters
containing the complete rubric. That length is the design constraint — the whole document may not
fit comfortably in one prompt alongside instructions, so expect the agent to need a locating step
(find the review-criteria section) before the extracting step.

## Part 2 — the rubric as a typed object

```
rubrics   opportunity_id, criteria[], max_points, extracted_at, confidence
```

A criterion has a name, a point value, and sub-criteria with their own point values. Two
invariants worth enforcing in the domain rather than hoping for:

- **Sub-criteria points should sum to the criterion's points**, and the criteria to `max_points`.
  When they don't, that is a measurable extraction fault — exactly the role that reconciliation
  plays in ingestion (note 07). Do not silently normalise; record the divergence.
- **Extraction confidence is a stored number**, not a vibe. The roadmap: *"below the confidence
  threshold: fall back to summary-conditioned drafting **and say so**."*

That fallback is the same shape as S2's `CalibrationBasis` (note 14): the system may use weaker
evidence, but the weakening is a value carried to the screen, never smoothed over. Merit.md's risk
table puts it plainly — the alternative is *"critiquing against a rubric it invented"*, which would
be confidently wrong in a way a user cannot detect.

## Part 3 — the critic that must cite

This is the slice's central rule, from CLAUDE.md's product rules and roadmap S4:

> **every score must cite a supporting sentence or the validator rejects it**

Mechanically: the critique response schema requires, per criterion, a score *and* a quoted span
from the draft. The validator checks the span actually appears in the draft — a substring check,
which is cheap and objective. A hallucinated quote fails the schema, the repair loop re-prompts,
and a second failure is an error value.

Why this specific mechanism: an LLM grading its own writing has no anchor and will drift toward
approval. Requiring a pointer into the text converts "this section is strong" into a claim that can
be false in a checkable way. It is the same move as S2's composed brief (note 14) — make the
product rule structural rather than aspirational — but applied to model output, where the guarantee
has to be a *validator* because you cannot build the sentence yourself.

**Calibration is a separate concern.** Merit.md §12 lists critique calibration as an eval: agent
scores against human scores on the same drafts, *"to detect a critic that flatters its own work."*
Citation prevents fabrication; only calibration detects generosity. Both are needed, and per
[ADR 0003](../docs/decisions/0003-evaluation-is-a-test-tier.md) the eval is a gated test tier, not
a script somebody remembers to run.

## Part 4 — what the output actually is

The most easily-lost design decision in the slice:

> The output is not a wall of generated prose. It is a marked-up draft that tells a development
> director where their remaining hours should go.

So the deliverable includes **what the model could not fix** — a criterion that stays weak because
it needs an unmeasured outcome or an unsigned partnership only a human has. An agent that ships
"revise until all scores are high" has built the wrong thing: it will fill those gaps with
plausible invented facts, which in a grant application is worse than a blank.

For foundation prospects there is no rubric, so drafting is conditioned on *the funder's own
observed purpose language* across its grant history — the `purpose` field already carried on every
`ReachabilityGrant` (see [`funder-reachability.ts:27`](../packages/domain/src/funder/funder-reachability.ts#L27)).
That field exists today and is unused; S4 is where it pays off.

## What S4 must not do

- **Invent a rubric.** Below threshold, degrade and say so.
- **Accept an uncited critique score.** The validator rejects it; there is no lenient mode.
- **Auto-submit anything.** *"The agent never submits an application and never contacts a funder."*
- **Hide the fallback.** "Drafted against the summary, not a rubric" belongs on the screen, not in
  a log line.
- **Spend the day's quota on one draft.** Multi-pass critique is exactly the workload note 16's
  priority queue exists for.

## How to verify an agent's S4 work

1. **An extraction eval against manually transcribed rubrics** — criteria recall and point-total
   agreement, as numbers in `eval_runs` (Merit.md §12). Ask for the numbers, not for "it works".
2. **A test with a deliberately unparseable announcement** proving the confidence threshold fires,
   the fallback is used, and the fallback is *visible in the returned value* — not just logged.
3. **A validator test with a fabricated quote** — a critique citing a sentence not in the draft is
   rejected. This is the single most important test in the slice.
4. **A revision-ordering test**: given scores, the 40-point criterion is revised before the 5-point
   one. Pure domain arithmetic, so this needs no model at all.
5. **A points-reconciliation test**: sub-criteria that don't sum are recorded as a fault, not
   silently rescaled.
6. **A critique calibration eval** with a committed threshold, per ADR 0003.
7. **An E2E through the draft studio** showing before/after per-criterion scores and at least one
   flagged "needs a human" criterion.

Then read one real output end to end. If it reads as finished prose with all scores high and
nothing flagged, the critic is flattering itself, whatever the tests say.

## Open questions to expect

- **Chunking a 94k-character announcement** without losing the criteria section — a locate-then-
  extract two-step, and how its cost is bounded.
- **Where the confidence threshold sits.** Per ADR 0003 and
  [ADR 0009](../docs/decisions/0009-link-thresholds-are-fitted-and-the-review-band-is-a-budget.md),
  a threshold like this should be *fitted against a curve*, not chosen by feel — the entity
  resolution work already set that precedent.
- **Whether the critique model should differ from the drafting model.** Same model grading its own
  output is a known weakness; the free tier may leave no choice, in which case say so rather than
  claiming independence.

## Learn more

- [Merit.md §9 — Rubric-grounded drafting](../submission_docs/Merit.md), and the appendix's 110-point rubric
- [poppler `pdftotext`](https://poppler.freedesktop.org/) — `-layout` and why it matters for tables
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) — the schema mechanism the validator sits behind
- [Grants.gov — how applications are reviewed](https://www.grants.gov/learn-grants/grants-101/grant-terminology) — background on review criteria
- Note [16 — the LLM orchestrator](16-the-llm-orchestrator.md), which S4's multi-pass loop leans on hardest
