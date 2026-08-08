# 22 — How to review a slice an agent says is done

**TL;DR:** `pnpm gate` proves the code compiles, obeys the layer rule, and passes its own tests. It
cannot prove the tests were written first, that the right things were tested, or that the product
rules survived. This note is the second half — the questions to ask, in the order that finds
problems fastest, plus the failure patterns specific to this codebase.

## The five-minute version

Run this, then read the diff:

```bash
pnpm gate          # format · types · lint · boundaries · boundaries:prove · domain-pure
                   # · no-skipped-tests · unit · integration
pnpm test:e2e      # the slice's own acceptance test
pnpm eval          # if the slice touched scoring or resolution
git diff --stat main
```

Then ask these six questions. They are ordered so that a "no" early makes the rest moot.

1. **Which acceptance criteria in [docs/roadmap.md](../docs/roadmap.md) did you check off, and where
   is the test for each?** A criterion checked without a test pointing at it is the single most
   common way a slice is "done" and isn't.
2. **Show me the commit where the test failed.** CLAUDE.md requires the red step to be *observed*.
   The tell for a test written after the code is that it cannot fail for the right reason — if the
   assertion is deleted, does the test still pass?
3. **What did you have to decide that the spec didn't decide for you?** Every real slice forces at
   least one. If the answer is "nothing", either the agent didn't notice or it's in the diff
   undocumented. Anything that constrains the future needs an ADR in [docs/decisions/](../docs/decisions/).
4. **What is not covered, and at which tier?** S2's honest answer is the model: the E2E fixture is
   one year, so turnover-over-time is proved at the integration tier and the gap is written into
   the roadmap (note 14). Silence here is worse than a gap.
5. **Where does the new code live, and why there?** Rules in `domain`, orchestration in
   `application`, I/O in `infrastructure`, screens in `apps`. The boundary checks catch bad
   *imports*, not misplaced *logic*.
6. **What would a user see if the third-party call failed?** Every external dependency needs an
   answer, and per [ADR 0011](../docs/decisions/0011-propublica-is-a-degradable-dependency.md) the
   answer is usually "the page renders and says what is missing" — never a blank section.

## Reading the diff in dependency order

Read it inward-out, not file-by-file. It matches how the code was supposed to be built (roadmap:
*failing E2E → domain → application → infrastructure → UI → E2E green*) and it puts the
highest-value review first:

```
1. tests/e2e/sN-*.spec.ts      what does the slice claim a user can now do?
2. packages/domain/**          the actual rules. 80% of real bugs are here
3. packages/application/**     orchestration, ports, coverage block
4. packages/infrastructure/**  parsing at the boundary, failure modes
5. apps/web/**                 formatting only — any logic here is misplaced
6. docs/                       roadmap ticks, ADRs, conventions
```

In the domain files, read the **comments explaining constants**. This codebase's convention is that
every non-obvious number cites where it came from — `MATERIALITY_FLOOR_RATE = 0.005` cites
`validation/RESULTS.txt`, `INTERMEDIARY_SATURATION = 3` explains why a fourth shared funder adds
nothing. A bare magic number in a new domain file is a review comment.

## The tier table, as a checklist

From CLAUDE.md. When an agent reports done, map each change to its row and ask for the test:

| Change | Required |
|---|---|
| Domain rule / scoring | Unit — happy path, boundaries, **every** failure mode |
| Use case | Unit with fakes **and** integration against a real database |
| Adapter (DB, HTTP, LLM, Google) | Integration against real infrastructure |
| Third-party API client | Contract test against the live API |
| UI feature | Component test **and** one E2E through the real stack |
| Bug fix | A test that fails before and passes after. Always |

**Mocks are allowed in unit and view-model tests only.** The fastest audit that exists here:

```bash
grep -rn "vi.mock\|vi.fn" tests/integration tests/contract tests/e2e
```

Anything found is either a misnamed unit test or a real violation. An "integration test" that mocks
our own code is a unit test wearing a hat.

## Failure patterns specific to this codebase

Learned from the slices already built and from the rules that exist because someone could get them
wrong:

| Pattern | How to spot it | Why it matters |
|---|---|---|
| **Missing data treated as zero** | A `?? 0` on a signal, a component defaulting instead of staying `null` | Note 09's central bug: it ranks an unknown funder below a known-closed one |
| **A silent fallback** | `catch` that logs and continues; an unknown enum falling to a default | The worst failure mode this system has. Unknown schema versions must raise |
| **Coverage dropped from a return type** | A new use case with no `coverage` block | "State coverage, never imply completeness" is a product rule |
| **One number in the UI** | A single score bar, a composite badge | Forbidden. Four components, always |
| **A claim with no citation** | New brief text not built from cited rows | S2 enforces this structurally; new code can still route around it |
| **Probability language** | "chance", "odds", "likelihood", "win rate" | There is no denominator (note 18) |
| **A model call before a deterministic filter** | Ordering inside a sweep handler | Breaks the cascade and the quota (notes 15, 16) |
| **`any`, `TODO`, `.skip`, commented-out code** | `pnpm gate` catches `.skip`; read for the rest | No shortcuts. Git remembers deleted code |
| **A hidden clock or `Math.random()` in domain** | `pnpm domain-pure` catches most | Untestable code is not shippable code |

## Per-slice: the one question that finds the most

| Slice | Ask |
|---|---|
| S1 | Does the Cape Fear benchmark pass in an automated test, and what is the current recall@50? |
| S2 | Open a claim in the UI — which filing does it name, and does that filing contain the number? |
| S3 | Show me the test where the model gateway throws if called, and the ineligible set that never calls it |
| S4 | Show me a critique score citing a sentence that isn't in the draft, and the validator rejecting it |
| S5 | Grep the UI strings for "probability" and friends. Then: what does an empty award history render? |
| S6 | Deliver the same job payload twice — how many emails and calendar events exist? |
| S7 | What happens when no tool fits the question? |
| S8 | Are the four bars still separate after retuning, and can a user see and reset their weights? |

## When something is wrong

Two things worth saying to an agent, because they change its behaviour more than a list of fixes:

- **"Report the failure instead."** CLAUDE.md: never mark a task complete with a failing or skipped
  test. An agent that hides a red test to finish the slice has cost you more than one that stops.
- **"Which rule does that break?"** The rules are written down — four in CLAUDE.md, the product
  rules under them, eleven ADRs. Pointing at the rule rather than at taste keeps the review
  objective, and if the rule is wrong, the answer is a PR changing the rule, not a quiet exception.

## Learn more

- [CLAUDE.md](../CLAUDE.md) — the four rules and the definition of done
- [docs/testing.md](../docs/testing.md) — the tiers in full · [docs/roadmap.md](../docs/roadmap.md) — the criteria
- [docs/decisions/](../docs/decisions/) — what has already been decided and must not be re-litigated silently
- Note [12 — slices, the gate, and how to work here](12-slices-the-gate-and-how-to-work.md) — the same ground from the builder's side
