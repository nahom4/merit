import { decideLink } from '@merit/domain';
import type { LinkThresholds, ScoredCandidate } from '@merit/domain';

/**
 * Threshold fitting, separated from the corpus query that feeds it.
 *
 * `decideLink` reads only the best and runner-up candidate, so an observation carrying the
 * top two scored candidates is a sufficient statistic for replaying the decision at any
 * threshold. Scoring the whole registry block once and sweeping over the cached top two is
 * what makes a full grid affordable on tens of thousands of labels.
 */
export interface LabelledObservation {
  /** The withheld truth: the EIN the filer itself stated for this recipient. */
  readonly truthEntityId: string;
  /** Best first. Two entries is all `decideLink` can see; more is wasted memory. */
  readonly topCandidates: readonly ScoredCandidate[];
}

export interface CurvePoint {
  readonly thresholds: LinkThresholds;
  /** Of the links made, the share pointing at the right organisation. */
  readonly precision: number;
  /** Of all labels, the share correctly linked. Unlinked labels count against it. */
  readonly recall: number;
  /** Of all labels, the share handed to a human instead of decided. */
  readonly reviewRate: number;
  readonly linked: number;
  readonly correct: number;
  readonly labels: number;
}

export interface ThresholdGrid {
  readonly link: readonly number[];
  readonly reject: readonly number[];
  readonly ambiguityMargin: readonly number[];
}

export const measureAt = (
  observations: readonly LabelledObservation[],
  thresholds: LinkThresholds,
): CurvePoint => {
  let linked = 0;
  let correct = 0;
  let reviewed = 0;

  for (const observation of observations) {
    const decision = decideLink(observation.topCandidates, thresholds);
    if (decision.kind === 'linked') {
      linked += 1;
      if (decision.entityId === observation.truthEntityId) correct += 1;
    } else if (decision.kind === 'needs_review') {
      reviewed += 1;
    }
  }

  const labels = observations.length;
  return {
    thresholds,
    precision: linked === 0 ? 0 : correct / linked,
    recall: labels === 0 ? 0 : correct / labels,
    reviewRate: labels === 0 ? 0 : reviewed / labels,
    linked,
    correct,
    labels,
  };
};

export const sweepThresholds = (
  observations: readonly LabelledObservation[],
  grid: ThresholdGrid,
): readonly CurvePoint[] => {
  const curve: CurvePoint[] = [];
  for (const link of grid.link) {
    for (const reject of grid.reject) {
      // reject > link is not a conservative operating point, it is a contradiction.
      if (reject > link) continue;
      for (const ambiguityMargin of grid.ambiguityMargin) {
        curve.push(measureAt(observations, { link, reject, ambiguityMargin }));
      }
    }
  }
  return curve;
};

/**
 * The operating point: the most recall obtainable at or above the precision target.
 *
 * Precision is a constraint rather than a term in a combined objective because the two
 * errors are not comparable. A wrong link attributes another organisation's grant history
 * to a funder and corrupts every signal computed from it; a missed link costs coverage on
 * one record. Trading a point of precision for several of recall would be arithmetic that
 * quietly makes the product worse.
 *
 * This chooses `link` and `ambiguityMargin` only. The reject threshold is deliberately not
 * part of the objective: it moves records between "rejected" and "needs_review" and cannot
 * change precision or recall by construction, so letting it into the tie-break would drive
 * it up to `link` and silently delete the review band in exchange for nothing. It is chosen
 * separately by `selectReviewBand`.
 *
 * Null when nothing on the curve clears the target — the honest answer when the scorer,
 * not the threshold, is what needs work.
 */
export const selectOperatingPoint = (
  curve: readonly CurvePoint[],
  minimumPrecision: number,
): CurvePoint | null => {
  const admissible = curve.filter((point) => point.precision >= minimumPrecision);
  if (admissible.length === 0) return null;

  return admissible.reduce((best, point) => {
    if (point.recall > best.recall) return point;
    if (point.recall === best.recall && point.precision > best.precision) return point;
    return best;
  });
};

/**
 * The reject threshold, chosen as a review-queue policy rather than by the objective.
 *
 * Everything between `reject` and `link` is preserved for a human; everything below is
 * discarded unseen. Lowering `reject` therefore rescues near-misses that would otherwise be
 * thrown away, at the cost of a larger queue — so the right choice is the widest band the
 * review budget can carry, not the narrowest.
 *
 * The budget is a share of all labels, and the queue is worked in descending grant size
 * rather than exhausted; it bounds what stays eligible for a human, not what one will read.
 */
export const selectReviewBand = (
  curve: readonly CurvePoint[],
  operatingPoint: { readonly link: number; readonly ambiguityMargin: number },
  reviewBudget: number,
): CurvePoint | null => {
  const candidates = curve
    .filter(
      (point) =>
        point.thresholds.link === operatingPoint.link &&
        point.thresholds.ambiguityMargin === operatingPoint.ambiguityMargin &&
        point.reviewRate <= reviewBudget,
    )
    .sort((a, b) => a.thresholds.reject - b.thresholds.reject);

  return candidates[0] ?? null;
};
