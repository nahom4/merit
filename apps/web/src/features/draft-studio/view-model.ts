import { revisionOrder } from '@merit/domain';
import type { DraftApplicationOutput } from '@merit/application';

/**
 * Everything the draft studio renders, formatted once and unit-tested.
 *
 * Three product rules are enforced here rather than hoped for.
 *
 * A draft always states what it was conditioned on, because rubric-conditioned prose and
 * summary-conditioned prose read identically and are worth different amounts.
 *
 * A per-criterion score never renders alone: it carries the sentence it cites, so a user can
 * check the judgement in a second instead of taking it on faith.
 *
 * And the revision pass is reported as what actually happened to the score, including when the
 * score did not move or went down. A studio that only ever shows improvement is not showing the
 * result, it is showing the intention.
 */

export interface CriterionScoreView {
  readonly criterionId: string;
  readonly criterionName: string;
  readonly before: string;
  readonly after: string | null;
  /** Where the bar sits, 0-100, for the criterion's own scale — not the whole rubric's. */
  readonly beforePercent: number;
  readonly afterPercent: number | null;
  readonly movement: 'improved' | 'unchanged' | 'worsened' | 'not_rescored';
  /** The sentence the reviewer cited. Verified to be in the draft before it was ever stored. */
  readonly citedSentence: string;
  readonly comment: string;
  readonly wasRevised: boolean;
}

export interface WeakCriterionView {
  readonly criterionName: string;
  readonly pointsAtStake: string;
  /** What the human has to supply. This is the studio's actual job. */
  readonly whatToSupply: string;
}

export interface DraftSectionView {
  readonly heading: string;
  readonly text: string;
  readonly subCriteria: readonly string[];
  readonly subCriteriaNote: string | null;
  readonly wasRevised: boolean;
  /** Bracketed gaps the drafting left for the human, pulled out so they are not missed. */
  readonly placeholders: readonly string[];
}

export interface DraftStudioView {
  readonly organizationName: string;
  readonly opportunityNumber: string;
  readonly opportunityTitle: string;
  /** The announcement's close date, for the deadline reminder. Null when it states none. */
  readonly closeDate: string | null;
  readonly backHref: string;
  /** The roadmap's "**and say so**", rendered above the draft in every case. */
  readonly conditioning: { readonly kind: 'rubric' | 'summary'; readonly note: string };
  readonly sections: readonly DraftSectionView[];
  readonly criteria: readonly CriterionScoreView[];
  readonly totalBefore: string | null;
  readonly totalAfter: string | null;
  readonly revisionSummary: string | null;
  readonly weakCriteria: readonly WeakCriterionView[];
  /** Non-null when the run was partial. Rendered, never swallowed. */
  readonly note: string | null;
  readonly critiqueEmptyReason: string | null;
}

/** A criterion scoring at or below this fraction of its points needs a human. */
const WEAK_AT = 0.6;

/** Square-bracket gaps the drafting deliberately left, e.g. "[the number served last year]". */
const placeholdersIn = (text: string): readonly string[] => [
  ...new Set([...text.matchAll(/\[([^\]]{3,200})\]/gu)].map((match) => `[${match[1]}]`)),
];

const percent = (score: number, max: number): number => (max === 0 ? 0 : Math.round((score / max) * 100));

export const toDraftStudioView = (
  output: DraftApplicationOutput,
  organizationName: string,
  organizationId: string,
): DraftStudioView => {
  const { draft, opportunity } = output;
  const revised = new Set(draft.revisedCriterionIds);
  const after = draft.critiqueAfter;

  const sections = draft.sections.map((section): DraftSectionView => {
    const wasRevised = section.criterionId !== null && revised.has(section.criterionId);
    return {
      heading: section.heading,
      text: section.text,
      subCriteria: section.subCriteria,
      subCriteriaNote:
        section.subCriteria.length > 0
          ? 'This section was written to answer the points a reviewer is told to look for, listed here.'
          : draft.conditioning.kind === 'summary'
            ? 'No criteria were available, so this section was written against the announcement’s summary.'
            : 'The announcement states no sub-criteria for this criterion.',
      wasRevised,
      placeholders: placeholdersIn(section.text),
    };
  });

  const criteria = (draft.critiqueBefore?.perCriterion ?? []).map((entry): CriterionScoreView => {
    const rescored = after?.perCriterion.find((later) => later.criterionId === entry.criterionId) ?? null;
    return {
      criterionId: entry.criterionId,
      criterionName: entry.criterionName,
      before: `${entry.score}/${entry.maxPoints}`,
      after: rescored === null ? null : `${rescored.score}/${rescored.maxPoints}`,
      beforePercent: percent(entry.score, entry.maxPoints),
      afterPercent: rescored === null ? null : percent(rescored.score, rescored.maxPoints),
      movement:
        rescored === null
          ? 'not_rescored'
          : rescored.score > entry.score
            ? 'improved'
            : rescored.score < entry.score
              ? 'worsened'
              : 'unchanged',
      // Always the latest judgement's citation, so the sentence shown is the sentence scored.
      citedSentence: (rescored ?? entry).citedSentence,
      comment: (rescored ?? entry).comment,
      wasRevised: revised.has(entry.criterionId),
    };
  });

  // Weakness is measured on the *current* draft — after revision if revision happened. Flagging
  // a criterion the revision pass already fixed would send the human to the wrong section.
  const current = after ?? draft.critiqueBefore;
  const weakCriteria = (current === null ? [] : revisionOrder(current))
    .filter((target) => target.maxPoints > 0 && 1 - target.pointsAtStake / target.maxPoints <= WEAK_AT)
    .map((target) => ({
      criterionName: target.criterionName,
      pointsAtStake: `${target.pointsAtStake} of ${target.maxPoints} points still unearned`,
      whatToSupply: target.comment,
    }));

  return {
    organizationName,
    opportunityNumber: opportunity.number,
    opportunityTitle: opportunity.title,
    closeDate: opportunity.closeDate,
    backHref: `/organizations/${organizationId}/opportunities`,
    conditioning: { kind: draft.conditioning.kind, note: draft.conditioning.note },
    sections,
    criteria,
    totalBefore:
      draft.critiqueBefore === null
        ? null
        : `${draft.critiqueBefore.totalScore}/${draft.critiqueBefore.totalPoints}`,
    totalAfter: after === null ? null : `${after.totalScore}/${after.totalPoints}`,
    revisionSummary: revisionSummaryOf(draft.critiqueBefore, after, draft.revisedCriterionIds.length),
    weakCriteria,
    note: draft.note,
    critiqueEmptyReason:
      draft.critiqueBefore === null
        ? draft.conditioning.kind === 'summary'
          ? 'This draft was not scored. Scoring needs the announcement’s own criteria, and they ' +
            'could not be read from it.'
          : 'This draft was not scored. The reason is stated above.'
        : null,
  };
};

/**
 * What revision actually did to the score, in a sentence — including when it did nothing or made
 * things worse. Both are real outcomes of asking a model to improve its own text, and a studio
 * that quietly omits them is not reporting a result.
 */
const revisionSummaryOf = (
  before: DraftApplicationOutput['draft']['critiqueBefore'],
  after: DraftApplicationOutput['draft']['critiqueAfter'],
  revisedCount: number,
): string | null => {
  if (before === null) return null;
  if (revisedCount === 0) {
    return 'No section was revised: nothing had enough points unearned to be worth a rewrite.';
  }
  if (after === null) {
    return `${revisedCount} section${revisedCount === 1 ? ' was' : 's were'} revised, but the revised draft could not be re-scored, so the scores below are for the text as first written.`;
  }

  const delta = after.totalScore - before.totalScore;
  const sections = `${revisedCount} section${revisedCount === 1 ? '' : 's'}`;
  if (delta > 0) {
    return `Revising ${sections} moved the score from ${before.totalScore} to ${after.totalScore} of ${after.totalPoints}, a gain of ${delta} points.`;
  }
  if (delta === 0) {
    return `Revising ${sections} did not move the score: it is still ${after.totalScore} of ${after.totalPoints}. The rewrite changed the words, not what a reviewer could award.`;
  }
  return `Revising ${sections} moved the score down, from ${before.totalScore} to ${after.totalScore} of ${after.totalPoints}. Prefer the earlier wording where they differ.`;
};
