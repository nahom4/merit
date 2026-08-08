import { describe, expect, it } from 'vitest';
import type { LinkScore, LinkThresholds, ScoredCandidate } from '@merit/domain';
import { measureAt, selectOperatingPoint, selectReviewBand, sweepThresholds } from './threshold-curve.js';
import type { CurvePoint, LabelledObservation } from './threshold-curve.js';

const score = (total: number): LinkScore => ({
  tokenSet: total,
  stringDistance: total,
  addressAgreement: total,
  total,
});

const candidate = (entityId: string, total: number): ScoredCandidate => ({
  entityId,
  score: score(total),
});

/** One label: the truth, and the top candidates the linker found for it. */
const observation = (
  truthEntityId: string,
  ...topCandidates: readonly ScoredCandidate[]
): LabelledObservation => ({ truthEntityId, topCandidates });

describe('measureAt', () => {
  it('counts a confident correct top candidate as a correct link', () => {
    const point = measureAt([observation('A', candidate('A', 0.97))], {
      link: 0.9,
      reject: 0.7,
      ambiguityMargin: 0.02,
    });

    expect(point.linked).toBe(1);
    expect(point.precision).toBe(1);
    expect(point.recall).toBe(1);
    expect(point.reviewRate).toBe(0);
  });

  it('counts a confident wrong top candidate against precision', () => {
    const point = measureAt([observation('A', candidate('B', 0.97))], {
      link: 0.9,
      reject: 0.7,
      ambiguityMargin: 0.02,
    });

    expect(point.linked).toBe(1);
    expect(point.precision).toBe(0);
    expect(point.recall).toBe(0);
  });

  it('costs recall but not precision when the link threshold rejects a correct candidate', () => {
    const point = measureAt([observation('A', candidate('A', 0.8))], {
      link: 0.95,
      reject: 0.7,
      ambiguityMargin: 0.02,
    });

    // Above reject, below link: the uncertain band, which is neither a link nor an error.
    expect(point.linked).toBe(0);
    expect(point.precision).toBe(0);
    expect(point.recall).toBe(0);
    expect(point.reviewRate).toBe(1);
  });

  it('routes two candidates inside the ambiguity margin to review rather than linking one', () => {
    const point = measureAt([observation('A', candidate('A', 0.97), candidate('B', 0.96))], {
      link: 0.9,
      reject: 0.7,
      ambiguityMargin: 0.02,
    });

    expect(point.linked).toBe(0);
    expect(point.reviewRate).toBe(1);
  });

  it('reports zero precision rather than dividing by zero when nothing links', () => {
    const point = measureAt([observation('A', candidate('A', 0.4))], {
      link: 0.9,
      reject: 0.7,
      ambiguityMargin: 0.02,
    });

    expect(point.linked).toBe(0);
    expect(point.precision).toBe(0);
    expect(point.recall).toBe(0);
    expect(point.reviewRate).toBe(0);
  });

  it('measures a mixed population as the proportion it is', () => {
    const point = measureAt(
      [
        observation('A', candidate('A', 0.97)),
        observation('B', candidate('B', 0.95)),
        observation('C', candidate('X', 0.94)),
        observation('D', candidate('D', 0.5)),
      ],
      { link: 0.9, reject: 0.7, ambiguityMargin: 0.02 },
    );

    expect(point.linked).toBe(3);
    expect(point.precision).toBeCloseTo(2 / 3, 10);
    expect(point.recall).toBeCloseTo(0.5, 10);
  });
});

describe('sweepThresholds', () => {
  it('measures every combination in the grid', () => {
    const curve = sweepThresholds([observation('A', candidate('A', 0.97))], {
      link: [0.9, 0.95],
      reject: [0.6, 0.7],
      ambiguityMargin: [0.02],
    });

    expect(curve).toHaveLength(4);
  });

  it('never emits a grid point whose reject threshold exceeds its link threshold', () => {
    // reject > link is not an operating point, it is a contradiction: it would reject
    // scores the link rule accepts.
    const curve = sweepThresholds([observation('A', candidate('A', 0.97))], {
      link: [0.8, 0.9],
      reject: [0.7, 0.85, 0.95],
      ambiguityMargin: [0.02],
    });

    for (const point of curve) {
      expect(point.thresholds.reject).toBeLessThanOrEqual(point.thresholds.link);
    }
    expect(curve.length).toBeGreaterThan(0);
  });
});

const point = (
  overrides: Partial<LinkThresholds> & { precision: number; recall: number; reviewRate?: number },
): CurvePoint => ({
  thresholds: {
    link: overrides.link ?? 0.9,
    reject: overrides.reject ?? 0.7,
    ambiguityMargin: overrides.ambiguityMargin ?? 0.02,
  },
  precision: overrides.precision,
  recall: overrides.recall,
  reviewRate: overrides.reviewRate ?? 0,
  linked: 100,
  correct: Math.round(100 * overrides.precision),
  labels: 100,
});

describe('selectOperatingPoint', () => {
  it('takes the highest recall among the points that clear the precision target', () => {
    const chosen = selectOperatingPoint(
      [
        point({ link: 0.99, precision: 0.995, recall: 0.4 }),
        point({ link: 0.92, precision: 0.98, recall: 0.62 }),
        point({ link: 0.85, precision: 0.93, recall: 0.8 }),
      ],
      0.97,
    );

    expect(chosen?.recall).toBeCloseTo(0.62, 10);
  });

  it('breaks a recall tie towards the more precise point', () => {
    const chosen = selectOperatingPoint(
      [
        point({ link: 0.92, precision: 0.98, recall: 0.62 }),
        point({ link: 0.93, precision: 0.99, recall: 0.62 }),
      ],
      0.97,
    );

    expect(chosen?.thresholds.link).toBeCloseTo(0.93, 10);
  });

  it('never lets the review rate decide, because the reject threshold cannot move recall', () => {
    // The failure this guards against: tie-breaking on a smaller queue drives reject up to
    // link, which deletes the review band without improving a single measured number.
    const chosen = selectOperatingPoint(
      [
        point({ reject: 0.7, precision: 0.98, recall: 0.62, reviewRate: 0.09 }),
        point({ reject: 0.9, precision: 0.98, recall: 0.62, reviewRate: 0.01 }),
      ],
      0.97,
    );

    expect(chosen?.thresholds.reject).toBeCloseTo(0.7, 10);
  });

  it('returns null rather than a point that misses the precision target', () => {
    // Silence is the honest answer: no operating point on this curve is acceptable, and
    // quietly returning the least-bad one would hide that.
    expect(selectOperatingPoint([point({ precision: 0.8, recall: 0.9 })], 0.97)).toBeNull();
  });
});

describe('selectReviewBand', () => {
  const base = { link: 0.8, ambiguityMargin: 0.08 };

  it('opens the band as wide as the review budget allows', () => {
    // A lower reject threshold preserves more near-misses for a human instead of discarding
    // them, so the widest affordable band is the one that wastes least.
    const chosen = selectReviewBand(
      [
        point({ ...base, reject: 0.5, precision: 0.98, recall: 0.66, reviewRate: 0.24 }),
        point({ ...base, reject: 0.7, precision: 0.98, recall: 0.66, reviewRate: 0.086 }),
        point({ ...base, reject: 0.8, precision: 0.98, recall: 0.66, reviewRate: 0.018 }),
      ],
      base,
      0.1,
    );

    expect(chosen?.thresholds.reject).toBeCloseTo(0.7, 10);
  });

  it('ignores points belonging to a different operating point', () => {
    const chosen = selectReviewBand(
      [
        point({
          link: 0.95,
          ambiguityMargin: 0.02,
          reject: 0.5,
          precision: 0.98,
          recall: 0.5,
          reviewRate: 0.05,
        }),
        point({ ...base, reject: 0.7, precision: 0.98, recall: 0.66, reviewRate: 0.086 }),
      ],
      base,
      0.1,
    );

    expect(chosen?.thresholds.link).toBeCloseTo(0.8, 10);
    expect(chosen?.thresholds.reject).toBeCloseTo(0.7, 10);
  });

  it('returns null when even the narrowest band exceeds the budget', () => {
    expect(
      selectReviewBand(
        [point({ ...base, reject: 0.8, precision: 0.98, recall: 0.66, reviewRate: 0.5 })],
        base,
        0.1,
      ),
    ).toBeNull();
  });
});
