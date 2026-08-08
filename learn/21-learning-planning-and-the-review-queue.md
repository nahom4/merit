# 21 — S8: learning from feedback, the portfolio shortlist, and the review queue

**Status: Designed.** Sources: [Merit.md §9 "Portfolio shortlisting" and "Learning from the user"](../submission_docs/Merit.md),
[roadmap S8](../docs/roadmap.md).

**TL;DR:** S8 closes the loop. Every accept, reject, override, and draft edit becomes a label;
prospect decisions retune *that organisation's* four component weights, so a director who keeps
rejecting out-of-state funders shifts their own geography weight without configuring anything.
Alongside it: a portfolio shortlist under one honest constraint, and a review queue for the
uncertain band of entity matches. The theme is that the system's uncertainty and the user's
judgement both become visible data.

## The big picture

```
   prospect list / draft studio / bid decisions
              │  accept · reject · override (with reason) · edit
              ▼
        feedback table   (org_id, target_ref, decision, reason, weight_deltas)
              │
     ┌────────┼─────────────────────┬──────────────────────┐
     ▼        ▼                     ▼                      ▼
 per-org   drafting profile     disagreement rate    portfolio ranking
 weights   (persistent edits)   (agent vs human)     (expected value)
     │
     ▼
 S1's four components, reweighted for this organisation only
```

Plus one queue that is not a learning loop but belongs to the same theme:

```
 entity_links where decision = 'review'   ← the uncertain band from S1's resolution
              │
              ▼   human confirms or rejects
        a link, and a new label
```

## Part 1 — retuning weights, and what must not change

S1's [`COMPONENT_WEIGHTS`](../packages/domain/src/prospect/prospect-score.ts) are `openness: 0.35,
affinity: 0.3, geographyFit: 0.2, sizeFit: 0.15` — and note 09 is honest that these are *"a
considered guess"*. S8 makes them per-organisation and learned from accept/reject.

Four constraints on how:

1. **The components stay legible.** Note 09's trade-off table says it plainly: S8 retunes *weights*,
   *"which keeps the components legible"*. Learning a model over the four inputs, or replacing them
   with a learned embedding, would break the product rule that four separate bars are always shown.
2. **Weights are per organisation, not global.** A literacy council in NC and a clinic in OH should
   diverge. Global learning would average away exactly the signal being captured.
3. **Learning must be slow and bounded.** Three rejections are not a preference. Expect bounded
   deltas, a floor and ceiling per weight, and a minimum sample before any movement — otherwise the
   list swings wildly in week one, which is when the user's trust is decided.
4. **It must be inspectable and reversible.** `weight_deltas` is a stored column for a reason. A
   user should be able to see "your geography weight has moved from 0.20 to 0.28 because you
   rejected 9 out-of-state funders" and reset it. An invisible personalisation that makes results
   worse is unfalsifiable from the user's chair.

The same shape applies to drafting: edits are diffed against generated text, and *persistent* edits
— the ones a user makes repeatedly — fold into that organisation's drafting profile. Persistent is
the load-bearing word. One edit is a correction; the same edit five times is a preference.

## Part 2 — the disagreement rate is the point, not a metric

> Bid/no-bid recorded against the agent's recommendation, disagreement rate visible

Most systems that learn from feedback use it silently and report nothing. Merit surfaces where the
agent and the human disagree, which does two things: it tells the user where not to trust the
agent, and it tells the developer which component is miscalibrated. It is the same instinct as
`eval_runs`, the reconciliation fault rate, and the run log — the system reports on itself as data.

If an agent implements S8 and the disagreement rate is not visible anywhere in the UI, a criterion
is unmet, however good the retuning is.

## Part 3 — the shortlist is a sort, and says so

Merit.md §9 makes two deliberate choices here and explains both:

**The constraint is application count, not staff hours.** Hours available and hours required would
both be numbers the user invented, *"making the output a chart of two guesses, whereas application
count is a figure a development office knows."* One honest input beats two plausible ones.

**It is a ranked shortlist, not an optimiser.** *"Under a count constraint with no interaction
between pursuits, the optimal solution is a sort, and calling it optimisation would oversell it."*

This is worth pausing on, because it is a general lesson: when the mathematics of a problem is
trivial, saying so is a feature. A knapsack solver here would add machinery, hide the logic, and
produce the same answer as `sort by expected value, take n`.

The other half of the criterion — *"with what is given up made explicit"* — is what makes the
shortlist honest. Showing the top 4 without the 5th and 6th hides the cost of the constraint.

## Part 4 — the review queue: the uncertain band is a budget

S1's resolution decides three ways: link, reject, or route to review
([ADR 0009](../docs/decisions/0009-link-thresholds-are-fitted-and-the-review-band-is-a-budget.md)).
The ADR's title is the insight: the review band is sized by *how much human attention exists*, not
by a threshold that feels right. S8 finally builds the surface where that attention is spent.

Two properties it needs:

- **Ordering by value, not by score.** A borderline match on a funder nobody's peers touch is worth
  less human time than one on a well-connected entity. Reviewing in score order spends the budget
  on whatever happens to be near the threshold.
- **Every confirmation is a new label.** The queue feeds the same fitting process that set the
  thresholds (note 08's withheld-EIN labels). Human review is expensive, so its output must not be
  thrown away after updating one row.

## How to verify an agent's S8 work

1. **A test that a single rejection moves weights by a bounded amount**, and that N rejections
   converge rather than run away. Pure domain arithmetic — no database.
2. **A test that weights are per organisation** — feedback from org A does not touch org B's list.
3. **A reset/inspection path**, with a test. Personalisation you cannot see or undo is a bug.
4. **A shortlist test**: given a count constraint, the returned set is the top-n by expected value
   *and* the response names what was excluded.
5. **A disagreement-rate assertion in the E2E**, since it is a stated criterion and the easiest one
   to quietly skip.
6. **A review-queue test** proving a confirmed match writes both the link and a label row.
7. **The four bars still render separately.** If retuning has collapsed them into one number, the
   slice has broken the product's central rule while satisfying its own checklist.

## Open questions to expect

- **The exact update rule.** Something bounded and interpretable — a small step toward the
  component that best separates accepted from rejected — beats gradient descent nobody can explain.
  Whatever is chosen needs an ADR, because it constrains every future scoring change.
- **Cold start.** A new organisation has no feedback and must use the default weights, and the UI
  should not imply personalisation that has not happened yet.
- **Interaction with the S1 eval.** Held-out funder recovery is measured against default weights;
  per-org weights make the eval's meaning subtler. Say which configuration the committed number
  refers to.
- **Feedback as an adversarial input.** A user who rejects everything should produce a degenerate
  but safe state, not a divide-by-zero.

## Learn more

- [Merit.md §9 — Portfolio shortlisting, Learning from the user](../submission_docs/Merit.md)
- [ADR 0009 — link thresholds are fitted and the review band is a budget](../docs/decisions/0009-link-thresholds-are-fitted-and-the-review-band-is-a-budget.md)
- [ADR 0006 — the prospect score is a transparent weighted sum](../docs/decisions/0006-prospect-score-is-a-transparent-weighted-sum.md) — the constraint S8's learning must not break
- [Human-in-the-loop / active learning](https://en.wikipedia.org/wiki/Active_learning_(machine_learning)) — the review queue's ordering problem, named
