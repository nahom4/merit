import { err, ok, ParseError, type Result } from '@merit/shared';

/**
 * The announcement's own scoring sheet, extracted from its PDF by a model.
 *
 * This is the least trustworthy input in the system. A fit score is a judgement about prose we
 * hold; a rubric is a *claim about a document* — the model can invent a criterion that reads
 * perfectly and appears nowhere in the NOFO, and nothing downstream would notice, because a
 * draft written against a hallucinated criterion looks exactly like a draft written against a
 * real one. Everything here exists to make that failure loud instead of silent.
 */

/** One scored criterion. `points` is what the reviewer may award, and it is what decides how
 *  much revision effort the criterion is worth — see `revisionOrder` in `critique.ts`. */
export interface RubricCriterion {
  /** The announcement's own label for it: "1", "A.2", "iii". Never renumbered by us. */
  readonly id: string;
  readonly name: string;
  readonly points: number;
  /** What a reviewer is told to look for. Drafting conditions each section on these, which is
   *  the whole reason sub-criteria are extracted separately rather than as one blob of prose. */
  readonly subCriteria: readonly string[];
}

export interface Rubric {
  readonly criteria: readonly RubricCriterion[];
  /** The sum of the criteria's points. Computed here, never taken from the model. */
  readonly totalPoints: number;
  /** The model's own claim about the extraction, capped by arithmetic. See `confidenceOf`. */
  readonly confidence: number;
  /** Why the confidence is what it is, in a sentence the UI shows the user. */
  readonly confidenceReason: string;
}

/**
 * Below this, the rubric is not trusted to condition drafting.
 *
 * It is not a measured constant. It is set where it is because the cost of being wrong is
 * asymmetric: drafting against a wrong rubric produces a confident document aimed at the wrong
 * target, which is worse than drafting against the announcement's summary and saying so. The
 * fallback is cheap; the failure is not. `evals/rubric-extraction.eval.test.ts` is what will
 * move it.
 */
export const RUBRIC_CONFIDENCE_THRESHOLD = 0.6;

export const isTrustworthy = (rubric: Rubric): boolean => rubric.confidence >= RUBRIC_CONFIDENCE_THRESHOLD;

/** Bounds. A model returning 400 criteria has found a table of contents, not a rubric. */
const MAX_CRITERIA = 30;
const MAX_SUB_CRITERIA = 20;
const MAX_NAME = 200;
const MAX_SUB_CRITERION = 600;

/**
 * The cap a self-reported confidence is subject to when the points do not add up.
 *
 * A model asked "how sure are you" answers about its own fluency, not its accuracy, so its
 * number alone is close to worthless. The arithmetic is not: if the extracted criteria sum to
 * 85 and the document says the total is 100, then 15 points of criteria were missed or
 * misread, and no amount of stated confidence changes that. Capping below the trust threshold
 * routes the pair to summary-conditioned drafting, which is the honest answer.
 */
const DISAGREEMENT_CAP = 0.4;

const fail = (message: string, field: string, received: unknown): Result<never, ParseError> =>
  err(
    new ParseError(message, {
      field,
      received: typeof received === 'object' ? JSON.stringify(received) : String(received),
    }),
  );

const confidenceOf = (
  stated: number,
  summed: number,
  totalStated: number | null,
): { readonly confidence: number; readonly reason: string } => {
  if (totalStated === null) {
    return {
      confidence: Math.min(stated, DISAGREEMENT_CAP),
      reason:
        `The announcement's stated total could not be read, so the ${summed} points extracted ` +
        'cannot be checked against it.',
    };
  }
  if (summed === totalStated) {
    return {
      confidence: stated,
      reason: `The extracted criteria sum to ${summed} points, which is the total the announcement states.`,
    };
  }
  return {
    confidence: Math.min(stated, DISAGREEMENT_CAP),
    reason:
      `The extracted criteria sum to ${summed} points but the announcement states ${totalStated}. ` +
      `${Math.abs(totalStated - summed)} points are unaccounted for, so the extraction is not trusted.`,
  };
};

const parse = (raw: unknown): Result<Rubric, ParseError> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('the model response must be a JSON object', 'response', raw);
  }
  const value = raw as Record<string, unknown>;

  const stated = value['confidence'];
  if (typeof stated !== 'number' || !Number.isFinite(stated) || stated < 0 || stated > 1) {
    return fail('confidence must be a number between 0 and 1', 'confidence', stated);
  }

  // Nullable on purpose: plenty of announcements never state a total, and "not stated" is a
  // different fact from "stated as zero". Both lower the confidence; only one is a parse error.
  const totalRaw = value['totalPointsStated'];
  const totalPointsStated =
    totalRaw === null || totalRaw === undefined
      ? null
      : typeof totalRaw === 'number' && Number.isInteger(totalRaw) && totalRaw > 0
        ? totalRaw
        : NaN;
  if (Number.isNaN(totalPointsStated)) {
    return fail(
      'totalPointsStated must be a positive integer, or null if the announcement does not state one',
      'totalPointsStated',
      totalRaw,
    );
  }

  const rawCriteria = value['criteria'];
  if (!Array.isArray(rawCriteria)) {
    return fail('criteria must be an array', 'criteria', rawCriteria);
  }
  if (rawCriteria.length === 0) {
    // An empty rubric is not a low-confidence rubric, it is a failed extraction. Returning it
    // would send drafting into a loop over nothing and call the result a draft.
    return fail('criteria must contain at least one criterion', 'criteria', rawCriteria.length);
  }
  if (rawCriteria.length > MAX_CRITERIA) {
    return fail(`criteria must contain at most ${MAX_CRITERIA} entries`, 'criteria', rawCriteria.length);
  }

  const criteria: RubricCriterion[] = [];
  const seen = new Set<string>();

  for (const entry of rawCriteria) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail('each criterion must be an object', 'criteria', entry);
    }
    const criterion = entry as Record<string, unknown>;

    const id = criterion['id'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      return fail('each criterion needs the announcement’s own id for it', 'criteria[].id', id);
    }
    // Duplicate ids would silently collapse a criterion's points during revision ordering.
    if (seen.has(id.trim())) {
      return fail('two criteria share one id', 'criteria[].id', id);
    }
    seen.add(id.trim());

    const name = criterion['name'];
    if (typeof name !== 'string' || name.trim().length === 0) {
      return fail('each criterion needs a name', 'criteria[].name', name);
    }
    if (name.length > MAX_NAME) {
      return fail(`a criterion name must be at most ${MAX_NAME} characters`, 'criteria[].name', name.length);
    }

    const points = criterion['points'];
    if (typeof points !== 'number' || !Number.isInteger(points) || points <= 0) {
      return fail('each criterion needs its point value as a positive integer', 'criteria[].points', points);
    }

    const subRaw = criterion['subCriteria'];
    if (!Array.isArray(subRaw)) {
      return fail(
        'subCriteria must be an array, empty if the criterion has none',
        'criteria[].subCriteria',
        subRaw,
      );
    }
    if (subRaw.length > MAX_SUB_CRITERIA) {
      return fail(
        `subCriteria must contain at most ${MAX_SUB_CRITERIA} entries`,
        'criteria[].subCriteria',
        subRaw.length,
      );
    }
    const subCriteria: string[] = [];
    for (const sub of subRaw) {
      if (typeof sub !== 'string' || sub.trim().length === 0) {
        return fail('subCriteria must contain only non-empty strings', 'criteria[].subCriteria', sub);
      }
      if (sub.length > MAX_SUB_CRITERION) {
        return fail(
          `each sub-criterion must be at most ${MAX_SUB_CRITERION} characters`,
          'criteria[].subCriteria',
          sub.length,
        );
      }
      subCriteria.push(sub.trim());
    }

    criteria.push({ id: id.trim(), name: name.trim(), points, subCriteria });
  }

  const totalPoints = criteria.reduce((sum, criterion) => sum + criterion.points, 0);
  const { confidence, reason } = confidenceOf(stated, totalPoints, totalPointsStated);

  return ok({ criteria, totalPoints, confidence, confidenceReason: reason });
};

/**
 * The shape the model is asked for. Part of the cache key, so editing it re-extracts every
 * rubric — which is correct, because a differently-worded question is a different answer.
 */
const responseContract = (): string =>
  [
    'Reply with JSON only, matching exactly this shape:',
    '{',
    '  "confidence": <number 0-1: how sure you are that this is the review rubric, read from the document>,',
    '  "totalPointsStated": <the total the document states, or null if it states none>,',
    '  "criteria": [',
    '    {',
    '      "id": "<the document\'s own label for this criterion, e.g. 1, A.2, iii>",',
    '      "name": "<the criterion\'s heading, in the document\'s words>",',
    '      "points": <integer, the points a reviewer may award for it>,',
    '      "subCriteria": [<what the document tells a reviewer to look for, one string each>]',
    '    }',
    '  ]',
    '}',
    'Extract only what the document states. Do not infer a criterion that is not written down,',
    'do not invent point values, and do not renumber. If the document contains no review',
    'criteria, return an empty criteria array and a confidence of 0.',
  ].join('\n');

export const Rubric = { parse, responseContract } as const;
