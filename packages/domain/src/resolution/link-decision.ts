import type { LinkScore } from './link-score.js';

export interface ScoredCandidate {
  readonly entityId: string;
  readonly score: LinkScore;
}

/**
 * Thresholds are fitted against the labelled set built from withheld Schedule I EINs, not
 * chosen by feel. The committed values live in evals/thresholds.json; these are the defaults
 * a fresh checkout starts from.
 *
 * Refit with `pnpm eval:fit`, which writes the curve these were read off to
 * evals/link-threshold-curve.json. See ADR-0009.
 */
export interface LinkThresholds {
  /** At or above: link. */
  readonly link: number;
  /** Below: reject. Between the two: a human decides. */
  readonly reject: number;
  /** Two candidates within this margin of each other cannot be separated by score alone. */
  readonly ambiguityMargin: number;
}

/**
 * Fitted on 9,980 withheld-EIN labels and verified on a held-out 9,981: precision 98.1%,
 * recall 65.7%, 8.5% routed to review. The link threshold is far lower than the 0.92 it was
 * first guessed at, and the ambiguity margin four times wider -- the curve says most of what
 * 0.92 was rejecting was correct, and that near-ties are where the errors actually live.
 */
export const DEFAULT_THRESHOLDS: LinkThresholds = {
  link: 0.8,
  reject: 0.7,
  ambiguityMargin: 0.08,
};

export type RejectionReason = 'no_candidate' | 'below_threshold';

/**
 * A discriminated union, not one object with three nullable fields. The uncertain band is a
 * first-class outcome: routing to review is the whole reason resolution can be trusted.
 */
export type LinkDecision =
  | { readonly kind: 'linked'; readonly entityId: string; readonly score: LinkScore }
  | { readonly kind: 'needs_review'; readonly entityId: string; readonly score: LinkScore }
  | { readonly kind: 'rejected'; readonly reason: RejectionReason; readonly score: LinkScore | null };

export const decideLink = (
  candidates: readonly ScoredCandidate[],
  thresholds: LinkThresholds,
): LinkDecision => {
  if (candidates.length === 0) {
    return { kind: 'rejected', reason: 'no_candidate', score: null };
  }

  const ranked = [...candidates].sort((a, b) => b.score.total - a.score.total);
  const best = ranked[0]!;
  const runnerUp = ranked[1];

  if (best.score.total < thresholds.reject) {
    return { kind: 'rejected', reason: 'below_threshold', score: best.score };
  }

  if (best.score.total >= thresholds.link) {
    // Two strong candidates within the margin are a coin flip. A wrong link corrupts every
    // downstream signal for that funder, so this goes to a human instead.
    const ambiguous =
      runnerUp !== undefined && best.score.total - runnerUp.score.total < thresholds.ambiguityMargin;
    if (!ambiguous) {
      return { kind: 'linked', entityId: best.entityId, score: best.score };
    }
  }

  return { kind: 'needs_review', entityId: best.entityId, score: best.score };
};
