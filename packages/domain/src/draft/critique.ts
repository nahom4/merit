import { err, ok, ParseError, type Result } from '@merit/shared';
import { normalizeForCitation } from './draft.js';
import type { Rubric } from './rubric.js';

/**
 * The self-critique: the draft scored against the rubric, one criterion at a time.
 *
 * The load-bearing rule is that **a score cites a sentence from the draft, or the whole
 * critique is rejected**. It is not a nicety. A critique is the one output here with no
 * external check on it — a fit score can be argued with by reading the announcement, a funder
 * brief traces to a filing, but "this section scores 48 of 60" is a number a model produced
 * about text a model produced. Requiring the citation, and then verifying the cited sentence is
 * genuinely in the draft, converts an unfalsifiable claim into one a user can check in a second.
 *
 * The check is mechanical and cheap and it is applied to every score, including zeros. A zero
 * is still a judgement about a specific sentence — "this is an enrolment count, not a
 * measurable objective" cites the sentence that fell short. There is no exemption, because an
 * exemption is where fabricated scores would go.
 */

export interface CriterionCritique {
  readonly criterionId: string;
  readonly criterionName: string;
  /** Points awarded. Bounded by the rubric's value, never by the model's opinion of it. */
  readonly score: number;
  readonly maxPoints: number;
  /** A sentence from the draft. Verified to be in it — see `Critique.parse`. */
  readonly citedSentence: string;
  /** What is wrong, specifically enough for a human to act on. */
  readonly comment: string;
}

export interface Critique {
  readonly perCriterion: readonly CriterionCritique[];
  readonly totalScore: number;
  readonly totalPoints: number;
}

/** One criterion's claim on the next revision pass. */
export interface RevisionTarget {
  readonly criterionId: string;
  readonly criterionName: string;
  /** `maxPoints - score`: what a perfect rewrite of this section would win back. */
  readonly pointsAtStake: number;
  readonly maxPoints: number;
  readonly comment: string;
}

const MAX_COMMENT = 1_000;
const MAX_CITATION = 1_000;

const fail = (message: string, field: string, received: unknown): Result<never, ParseError> =>
  err(
    new ParseError(message, {
      field,
      received: typeof received === 'object' ? JSON.stringify(received) : String(received),
    }),
  );

/**
 * Scores the draft against the rubric.
 *
 * `draftText` is the whole draft, not one section: a critique of criterion 2 may legitimately
 * cite a sentence that ended up under criterion 1's heading, and rejecting that would punish
 * the model for being right about the document.
 */
const parse = (raw: unknown, rubric: Rubric, draftText: string): Result<Critique, ParseError> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('the model response must be a JSON object', 'response', raw);
  }
  const rawScores = (raw as Record<string, unknown>)['scores'];
  if (!Array.isArray(rawScores)) {
    return fail('scores must be an array', 'scores', rawScores);
  }

  const byId = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]));
  const haystack = normalizeForCitation(draftText);
  const perCriterion: CriterionCritique[] = [];
  const scored = new Set<string>();

  for (const entry of rawScores) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail('each score must be an object', 'scores', entry);
    }
    const score = entry as Record<string, unknown>;

    const criterionId = score['criterionId'];
    if (typeof criterionId !== 'string' || criterionId.trim().length === 0) {
      return fail('each score must name the criterion it is for', 'scores[].criterionId', criterionId);
    }
    const criterion = byId.get(criterionId.trim());
    if (criterion === undefined) {
      return fail(
        `scored a criterion that is not in the rubric: ${criterionId}`,
        'scores[].criterionId',
        criterionId,
      );
    }
    if (scored.has(criterion.id)) {
      return fail(`criterion ${criterion.id} was scored twice`, 'scores[].criterionId', criterionId);
    }
    scored.add(criterion.id);

    const points = score['score'];
    if (typeof points !== 'number' || !Number.isInteger(points) || points < 0) {
      return fail('a score must be an integer of zero or more', 'scores[].score', points);
    }
    if (points > criterion.points) {
      return fail(
        `criterion ${criterion.id} is worth ${criterion.points} points and was scored ${points}`,
        'scores[].score',
        points,
      );
    }

    const comment = score['comment'];
    if (typeof comment !== 'string' || comment.trim().length === 0) {
      return fail('each score must say what is wrong, specifically', 'scores[].comment', comment);
    }
    if (comment.length > MAX_COMMENT) {
      return fail(`a comment must be at most ${MAX_COMMENT} characters`, 'scores[].comment', comment.length);
    }

    const citedSentence = score['citedSentence'];
    if (typeof citedSentence !== 'string' || citedSentence.trim().length === 0) {
      return fail(
        'each score must cite the sentence from the draft it is judging',
        'scores[].citedSentence',
        citedSentence,
      );
    }
    if (citedSentence.length > MAX_CITATION) {
      return fail(
        `a cited sentence must be at most ${MAX_CITATION} characters`,
        'scores[].citedSentence',
        citedSentence.length,
      );
    }

    // The check the module exists for. Whitespace-insensitive, because a model re-typing a
    // sentence it just wrote differs by a line break; otherwise exact, because "approximately
    // the draft" is how a fabricated citation gets through.
    if (!haystack.includes(normalizeForCitation(citedSentence))) {
      return fail(
        `the sentence cited for criterion ${criterion.id} does not appear in the draft`,
        'scores[].citedSentence',
        citedSentence,
      );
    }

    perCriterion.push({
      criterionId: criterion.id,
      criterionName: criterion.name,
      score: points,
      maxPoints: criterion.points,
      citedSentence: citedSentence.trim(),
      comment: comment.trim(),
    });
  }

  // A partial critique read as a whole one would understate the total and misdirect revision
  // towards whatever happened to be scored.
  if (scored.size !== rubric.criteria.length) {
    const missing = rubric.criteria.filter((criterion) => !scored.has(criterion.id)).map((c) => c.id);
    return fail(
      `every criterion must be scored; ${missing.join(', ')} was not`,
      'scores',
      missing.join(', '),
    );
  }

  return ok({
    perCriterion,
    totalScore: perCriterion.reduce((sum, entry) => sum + entry.score, 0),
    totalPoints: rubric.totalPoints,
  });
};

/**
 * What to revise, in the order worth revising it.
 *
 * Ordered by points recoverable, not by score: a criterion scoring 30% of 40 points is a worse
 * *score* than one scoring 80% of 60, and a worse *use of a revision call* — 28 points against
 * 12. Revision costs a model call each, the quota is finite, and spending it on the most
 * embarrassing number rather than the most valuable one is how a budget gets wasted politely.
 *
 * Ties break on the criterion's total value, then on its id, so the order is stable across runs.
 */
export const revisionOrder = (critique: Critique): readonly RevisionTarget[] =>
  critique.perCriterion
    .map((entry) => ({
      criterionId: entry.criterionId,
      criterionName: entry.criterionName,
      pointsAtStake: entry.maxPoints - entry.score,
      maxPoints: entry.maxPoints,
      comment: entry.comment,
    }))
    .sort(
      (a, b) =>
        b.pointsAtStake - a.pointsAtStake ||
        b.maxPoints - a.maxPoints ||
        a.criterionId.localeCompare(b.criterionId),
    );

const responseContract = (rubric: Rubric): string =>
  [
    'Reply with JSON only, matching exactly this shape:',
    '{',
    '  "scores": [',
    '    {',
    '      "criterionId": "<the criterion id, exactly as given>",',
    '      "score": <integer, from 0 to the points that criterion is worth>,',
    '      "citedSentence": "<one sentence copied verbatim from the draft above, which your score is a judgement about>",',
    '      "comment": "<what is missing or weak, specifically enough to act on>"',
    '    }',
    '  ]',
    '}',
    `Score every criterion, all ${rubric.criteria.length} of them, and no others.`,
    'The cited sentence must be copied from the draft word for word. If you cannot find a',
    'sentence in the draft that your score is about, the score is wrong — reconsider it.',
    'Do not award more points than a criterion is worth.',
  ].join('\n');

export const Critique = { parse, responseContract } as const;
