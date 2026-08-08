import type { Result } from '@merit/shared';
import type { Critique, DraftConditioning, DraftSection, Rubric } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

/**
 * A draft, everything that produced it, and everything that judged it.
 *
 * The critique is stored twice on purpose. `critiqueBefore` is the score of the text as first
 * written; `critiqueAfter` is the score of the text after revision. The studio shows both,
 * because a per-criterion score with nothing to compare it to is a number a user has to take on
 * faith, and the pair is what makes the revision pass falsifiable — if the second score is not
 * better than the first, revision did not work, and the screen says so rather than hiding it.
 */
export interface StoredDraft {
  readonly organizationId: string;
  /** The federal announcement this drafts against, or the funder EIN for a foundation draft. */
  readonly targetId: string;
  readonly targetKind: DraftTargetKind;
  /** Null when no rubric could be read at all. `conditioning` says which case this is. */
  readonly rubric: Rubric | null;
  readonly conditioning: DraftConditioning;
  readonly sections: readonly DraftSection[];
  /** Null when the quota ran out before the draft could be judged. */
  readonly critiqueBefore: Critique | null;
  readonly critiqueAfter: Critique | null;
  /** Which criteria the revision pass actually spent a call on, in the order it spent them. */
  readonly revisedCriterionIds: readonly string[];
  /**
   * What went wrong, if anything, in words. Non-null means the draft is partial — the quota ran
   * out mid-run, or a document could not be read. A partial draft is served with its note, not
   * suppressed: half a draft and an explanation beats a spinner.
   */
  readonly note: string | null;
  readonly draftedAt: string;
}

/** A federal announcement, or a foundation from the giving graph. The two are drafted against
 *  different evidence — a rubric on one side, observed purpose language on the other. */
export type DraftTargetKind = 'federal' | 'foundation';

export interface DraftRepository {
  /** Idempotent on (organisation, target): re-drafting replaces, it does not accumulate. */
  saveDraft(draft: StoredDraft): Promise<Result<void, RepositoryUnavailable>>;

  findDraft(
    organizationId: string,
    targetId: string,
  ): Promise<Result<StoredDraft | null, RepositoryUnavailable>>;
}
