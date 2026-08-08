import { describe, expect, it } from 'vitest';
import { decideLink, DEFAULT_THRESHOLDS } from './link-decision.js';

const score = (total: number) => ({
  tokenSet: total,
  stringDistance: total,
  addressAgreement: total,
  total,
});

const candidate = (id: string, total: number) => ({ entityId: id, score: score(total) });

describe('decideLink', () => {
  it('links the best candidate when it scores above the high threshold', () => {
    const decision = decideLink([candidate('ein_1', 0.97)], DEFAULT_THRESHOLDS);
    expect(decision.kind).toBe('linked');
    expect(decision.kind === 'linked' && decision.entityId).toBe('ein_1');
  });

  it('rejects when the best candidate scores below the low threshold', () => {
    expect(decideLink([candidate('ein_1', 0.2)], DEFAULT_THRESHOLDS).kind).toBe('rejected');
  });

  it('routes an in-between score to review instead of guessing', () => {
    expect(decideLink([candidate('ein_1', 0.75)], DEFAULT_THRESHOLDS).kind).toBe('needs_review');
  });

  it('rejects when there are no candidates at all', () => {
    expect(decideLink([], DEFAULT_THRESHOLDS).kind).toBe('rejected');
  });

  it('picks the highest-scoring candidate when several clear the threshold', () => {
    // Separated by more than the ambiguity margin, so this exercises the ordering rather
    // than the near-tie rule.
    const decision = decideLink([candidate('ein_1', 0.85), candidate('ein_2', 0.99)], DEFAULT_THRESHOLDS);
    expect(decision.kind === 'linked' && decision.entityId).toBe('ein_2');
  });

  it('routes to review when two candidates are both strong and too close to separate', () => {
    // Two organisations with near-identical names in one city. Picking either would be a
    // coin flip, and a wrong link corrupts every downstream score.
    const decision = decideLink([candidate('ein_1', 0.97), candidate('ein_2', 0.965)], DEFAULT_THRESHOLDS);
    expect(decision.kind).toBe('needs_review');
  });

  it('links when the runner-up is clearly behind', () => {
    const decision = decideLink([candidate('ein_1', 0.97), candidate('ein_2', 0.8)], DEFAULT_THRESHOLDS);
    expect(decision.kind).toBe('linked');
  });

  it('carries the score into the decision so it can be stored and audited', () => {
    const decision = decideLink([candidate('ein_1', 0.97)], DEFAULT_THRESHOLDS);
    expect(decision.score?.total).toBeCloseTo(0.97);
  });

  it('names the reason a record was rejected', () => {
    const decision = decideLink([], DEFAULT_THRESHOLDS);
    expect(decision.kind === 'rejected' && decision.reason).toBe('no_candidate');
  });

  it('distinguishes a rejection for a weak best score from one for no candidates', () => {
    const decision = decideLink([candidate('ein_1', 0.2)], DEFAULT_THRESHOLDS);
    expect(decision.kind === 'rejected' && decision.reason).toBe('below_threshold');
  });

  it('honours thresholds fitted against the labelled set rather than hard-coded ones', () => {
    const strict = { link: 0.99, reject: 0.9, ambiguityMargin: 0.01 };
    expect(decideLink([candidate('ein_1', 0.97)], strict).kind).toBe('needs_review');
  });
});
