# 08 — Entity Resolution: Turning `ST PATRICK CATHOLIC SCH` Into a Real Organisation

**TL;DR:** Filings name the funder by EIN but the recipient only as free text. Until those strings become real registry-anchored organisations, the graph is unusable. Merit does record linkage against the IRS registry — normalise, block, score, decide — never guesses in the uncertain band, and measures its own accuracy for free by withholding EINs that Schedule I already states.

## The big picture

```
  "St. Patrick's Catholic School"          IRS Business Master File
   from a 990-PF filing                    ~1.8M registered nonprofits
          │                                          │
          ▼ normalise                                ▼ normalise (identically!)
   "SAINT PATRICK CATHOLIC SCHOOL"          "SAINT PATRICK CATHOLIC SCHOOL"
          │                                          │
          └────────────► block on  NC:S563  ◄────────┘        ~200 candidates,
                                   │                           not 1.8M
                                   ▼ score each candidate
                     tokenSet 0.5 · stringDistance 0.3 · address 0.2
                                   │
                                   ▼ decide against fitted thresholds
                    ≥0.92 → linked    0.70–0.92 → needs_review    <0.70 → rejected
```

Four stages, four files, all pure domain — [`normalized-name.ts`](../packages/domain/src/resolution/normalized-name.ts), [`link-score.ts`](../packages/domain/src/resolution/link-score.ts), [`link-decision.ts`](../packages/domain/src/resolution/link-decision.ts) — orchestrated by one use case, [`resolve-recipients.use-case.ts`](../packages/application/src/use-cases/resolve-recipients/resolve-recipients.use-case.ts).

## Why this is the load-bearing component

```ts
// packages/application/src/use-cases/resolve-recipients/resolve-recipients.use-case.ts:32-38
/**
 * Links free-text recipient strings to real registered organisations.
 *
 * This is the load-bearing component of the system: every prospect score, peer set, and
 * funder signal depends on it being right. Which is why it never guesses -- an uncertain
 * match is routed to a human rather than resolved by coin flip.
 */
```

Every downstream number is an aggregate over resolved links. A wrong link corrupts a funder's turnover, its grantee count, its geography, and the peer set of the organisation it was wrongly attached to.

## The decision that shaped everything: link, don't cluster

The obvious approach is to cluster the recipient strings against *each other* — group the spellings that look alike. `Merit.md` §8 rejects it:

> Clustering the recipient strings against each other is the obvious approach and the wrong one. It is unbounded, hard to measure, and produces clusters with no program code, no budget, and no address, which is to say nothing the scoring in §9 can use.

Linking against the **BMF** — the IRS registry of every registered US nonprofit — turns an open-ended clustering problem into **record linkage against a known target set**. And a linked record *inherits* the registry's EIN, NTEE code, city, state, and revenue — which are exactly the inputs prospect scoring needs.

That is the difference between a clever result and a useful one. A cluster tells you two strings are probably the same; a link tells you the recipient is a $1.2M education nonprofit in Painesville, Ohio.

Unlinked records are not discarded — they still count toward funder-side statistics like grant counts and amounts. They are only excluded from peer matching, which is the part that needs registry attributes.

## Stage 1 — normalise, identically on both sides

```ts
// packages/domain/src/resolution/normalized-name.ts:1-6
/**
 * Normalisation for record linkage. Applied identically to both sides -- the free-text
 * recipient string from a filing, and the canonical name from the IRS registry. Applying it
 * to only one side is the classic way to get a resolution pipeline that quietly matches
 * nothing.
 */
```

That warning is the single most important sentence in the file. Asymmetric normalisation produces a pipeline that runs, reports no errors, and matches ~nothing.

The steps, in order (order matters):

1. Uppercase.
2. **Strip possessives before punctuation** — `/['']S\b/` → `''`. The comment explains the ordering: doing it first means plurals like `BOYS` and `CENTERS` survive, whereas stripping punctuation first would turn `PATRICK'S` into `PATRICKS` and lose the distinction.
3. Strip remaining punctuation, collapse whitespace.
4. **Expand abbreviations** from a 40-entry controlled dictionary — `ST`→`SAINT`, `FDN`/`FND`/`FOUND`→`FOUNDATION`, `CTR`→`CENTER`, `TR`/`TUA`→`TRUST`. Note *"Expanded, never contracted: one target spelling per concept."* Expansion is confluent; contraction invites collisions.
5. Drop a **leading** `THE` — *"Filings are inconsistent about a leading article; a trailing one never occurs."*
6. Strip legal suffixes (`INC`, `LLC`, `CORP`…) **only from the end**, and only while more than one token remains:

```ts
// packages/domain/src/resolution/normalized-name.ts:52-55
/**
 * Legal form, not identity. Stripped only from the end of the name -- "Incarnation House"
 * must not become "arnation House", and a suffix in the middle of a name is part of it.
 */
```

`tokensOf` then drops stop words (`OF`, `THE`, `AND`, `FOR`…) — *"words too common to distinguish two organisations from each other."*

## Stage 2 — block, or the search is infeasible

1.4M grant records × 1.8M registry rows is 2.5 × 10¹² comparisons. Blocking cuts it to something tractable by only comparing records that share a cheap key:

```ts
// packages/domain/src/resolution/normalized-name.ts:150-159
/**
 * Comparing a recipient string against 1.8M registry rows pairwise is infeasible, so
 * candidates are blocked on state plus the phonetic code of the first significant token.
 */
export const blockingKey = (normalized: string, state: string): string | null => {
  const [first] = [...tokensOf(normalized)];
  if (first === undefined) return null;
  const code = soundex(first);
  return code === '' ? null : `${state.toUpperCase()}:${code}`;
};
```

**Soundex** maps a word to a letter plus three digits by consonant class (`SMITH` and `SMYTHE` both → `S530`), so spelling variants land in the same block. The implementation ([lines 131-148](../packages/domain/src/resolution/normalized-name.ts#L131-L148)) includes the classic subtlety that `H` and `W` are *transparent* — they do not break a run of same-coded consonants.

The design principle behind the choice is stated outright:

```ts
// lines 126-130
/**
 * Soundex, used only as a blocking key -- never as a match. It is deliberately loose: a block
 * that is slightly too wide costs comparisons, while a block that is too narrow loses the
 * true match before scoring ever sees it.
 */
```

**Blocking errors are asymmetric.** A too-wide block costs CPU; a too-narrow block loses the true match *irrecoverably*, before scoring is ever consulted. So err wide.

The blocking key is precomputed into the `entities` table with an index — [`0002-create-giving-graph.sql:58-61`](../packages/infrastructure/src/persistence/migrations/0002-create-giving-graph.sql#L58-L61) — and the use case caches candidate lists per block within a batch, since a block of 200 registry rows is reused by every grant naming an organisation in that state with that phonetic key ([`resolve-recipients.use-case.ts:52-54`](../packages/application/src/use-cases/resolve-recipients/resolve-recipients.use-case.ts#L52-L54)).

## Stage 3 — score, with the parts visible

```ts
// packages/domain/src/resolution/link-score.ts:11-20
/**
 * A score with its parts visible. A single number would make every review-queue decision
 * unexplainable, and the thresholds in `LinkDecision` are fitted against these parts.
 */
export interface LinkScore {
  readonly tokenSet: number;
  readonly stringDistance: number;
  readonly addressAgreement: number;
  readonly total: number;
}
```

Same principle as the prospect score: **keep the components, they are the explanation.**

| Component | Weight | Measure | Why this one |
|---|---|---|---|
| `tokenSet` | 0.5 | Jaccard over significant tokens | Order-insensitive — filings reorder words freely |
| `stringDistance` | 0.3 | Jaro-Winkler | Prefix bonus: *"organisation names agree at the front and diverge at the end (`… COUNCIL`, `… INC`)"* |
| `addressAgreement` | 0.2 | state / city / ZIP5 agreement | Adjudicates between genuinely similar names |

Two judgements encoded in the weights and in address handling:

```ts
// link-score.ts:102-106
/**
 * Weights: the name carries the decision, the address adjudicates between organisations whose
 * names genuinely resemble each other. Address alone must never carry a link -- half the
 * charities in a small city share a ZIP code.
 */
```

```ts
// link-score.ts:80-83
/**
 * Address agreement in [0, 1]. An unstated address is 0.5, not 0: 990-PF records frequently
 * omit the city, and treating silence as disagreement would reject correct links.
 */
```

**Missing ≠ disagreeing.** With a 0.2 weight, scoring silence as 0 would push correct links below threshold en masse. Neutral 0.5 is the honest encoding of "no evidence either way" — the same instinct as `null` components in the prospect score ([note 09](09-funder-signals-and-the-prospect-score.md)).

ZIPs compare on the five-digit prefix only, because filings carry ZIP+4 inconsistently.

## Stage 4 — decide three ways, not two

```ts
// packages/domain/src/resolution/link-decision.ts:30-37
/**
 * A discriminated union, not one object with three nullable fields. The uncertain band is a
 * first-class outcome: routing to review is the whole reason resolution can be trusted.
 */
export type LinkDecision =
  | { kind: 'linked';       entityId: string; score: LinkScore }
  | { kind: 'needs_review'; entityId: string; score: LinkScore }
  | { kind: 'rejected';     reason: RejectionReason; score: LinkScore | null };
```

Defaults: link at ≥ 0.92, reject below 0.70, and an **ambiguity margin** of 0.02:

```ts
// link-decision.ts:56-58
// Two strong candidates within the margin are a coin flip. A wrong link corrupts every
// downstream signal for that funder, so this goes to a human instead.
```

Two candidates at 0.95 and 0.94 are *both above the link threshold* and the right answer is still "I don't know". A threshold-only rule would link the top one 50% wrongly. Worth internalising: **absolute confidence and relative confidence are different questions, and you need both.**

And on the thresholds themselves:

```ts
// link-decision.ts:8-12
/**
 * Thresholds are fitted against the labelled set built from withheld Schedule I EINs, not
 * chosen by feel. The committed values live in evals/thresholds.json; these are the defaults
 * a fresh checkout starts from.
 */
```

## The free labelled dataset — the best idea in the project

Schedule I records state the recipient's **EIN** *and* the messy free-text name. 990-PF records state only the name. In one sample bundle, 6,917 of 7,777 Schedule I records (89%) carried an EIN.

So: **withhold the EIN, run the full pipeline on name and address alone, compare the prediction to the withheld truth.** Across a full year that is on the order of **80,000 labelled examples**, drawn from exactly the population of messy names the system must handle, refreshed monthly, at no cost.

It is a one-flag change because the pipeline has no hidden I/O:

```ts
// resolve-recipients.use-case.ts:24-29
/**
 * Ignore the EIN a Schedule I filing states and resolve on name and address alone. This is
 * how the labelled evaluation set is built: withhold the truth, predict, compare.
 */
readonly ignoreStatedEin?: boolean;
```

In production the stated EIN is simply believed — *"scoring a name against it would be strictly worse than believing the filer"* ([lines 87-98](../packages/application/src/use-cases/resolve-recipients/resolve-recipients.use-case.ts#L87-L98)) — and counted separately as `fromStatedEin`, so the reported metrics are never inflated by the easy cases.

**The limitation is stated rather than hidden** ([ADR-0003](../docs/decisions/0003-evaluation-is-a-test-tier.md), `Merit.md` §8): Schedule I filers are public charities, the target population is private foundations, so there is mild distribution shift. A held-out hand-labelled 990-PF sample measures whether the fitted thresholds transfer, and **the gap is reported every run, not assumed away.**

## Two honest degradations

A grant with no recipient state gets `rejected: no_candidate`, because blocking needs a state and comparing against all 1.8M rows *"is not a search this can afford"* ([lines 100-107](../packages/application/src/use-cases/resolve-recipients/resolve-recipients.use-case.ts#L100-L107)). Same if the name yields no blocking key. Both are recorded as rejections with reasons rather than dropped silently — so the rejection rate is a number you can look at.

## Applied in this project

- [`packages/domain/src/resolution/`](../packages/domain/src/resolution/) — normalise, score, decide (all pure, all unit-tested)
- [`resolve-recipients.use-case.ts`](../packages/application/src/use-cases/resolve-recipients/resolve-recipients.use-case.ts) — orchestration, block cache, tallies
- [`0002-create-giving-graph.sql:46-81`](../packages/infrastructure/src/persistence/migrations/0002-create-giving-graph.sql#L46-L81) — `entities` (with `blocking_key` index) and `entity_links` (with `reviewed_by` / `reviewed_at` for the review queue)
- [`ADR-0003`](../docs/decisions/0003-evaluation-is-a-test-tier.md) — why the eval is a gated test tier

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Cluster recipient strings against each other | Unbounded, unmeasurable, and yields clusters with no NTEE code, revenue, or address |
| Embeddings + vector similarity | No labelled advantage over the cheap features here, plus cost per record across 2M rows and no explainable score to show a reviewer |
| Two-way decision (link / reject) | Forces a coin flip in the uncertain band, and a wrong link corrupts every downstream signal |
| Choose thresholds by inspection | Guessing, when 80,000 free labels are available |

**Known softness:** Soundex is English-centric and weak on the first letter (`KATHERINE` / `CATHERINE` block differently). A phonetic algorithm like Double Metaphone would block better. Given that blocking errors are unrecoverable, this is probably the first place to look if recall measures low.

## Learn more

- [Wikipedia — Record linkage](https://en.wikipedia.org/wiki/Record_linkage) — and the Fellegi–Sunter model this is a hand-tuned cousin of
- [Wikipedia — Jaro–Winkler distance](https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance)
- [Wikipedia — Soundex](https://en.wikipedia.org/wiki/Soundex)
- [Christen — *Data Matching*](https://link.springer.com/book/10.1007/978-3-642-31164-2) — the standard reference on blocking and classification
- [IRS — EO Business Master File Extract](https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf)
