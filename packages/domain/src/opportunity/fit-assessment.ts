import { err, ok, ParseError, type Result } from '@merit/shared';

/**
 * A model's judgement of how well an opportunity fits an organisation, after it has been
 * parsed -- and only what survives parsing is ever stored.
 *
 * Unlike the prospect score, which is arithmetic, this one is a judgement: the inputs are prose
 * on both sides. The product rule still holds. A bare number is forbidden, so the matched
 * program areas and the gaps are part of the value rather than optional extras, and a response
 * missing either of them is not a partial success. It is a parse failure.
 */
export interface FitAssessment {
  /** 0–100, integer. Never called a win probability: public data has no denominator. */
  readonly fitScore: number;
  readonly rationale: string;
  /** Chosen from a menu, never invented. See `responseContract`. */
  readonly matchedProgramAreas: readonly string[];
  /** What the announcement asks for that this organisation cannot currently show. */
  readonly gaps: readonly string[];
}

/**
 * Above this, an opportunity is worth a human's attention -- the threshold S6 alerts on and S4
 * extracts a rubric for. Set where it is because the cascade's next stages are expensive:
 * rubric extraction and drafting are the costliest calls in the system, and 70 is the point at
 * which the announcement's purpose language and the organisation's programs genuinely overlap
 * rather than merely coexisting. It is a starting point to be moved by the fit-score eval
 * (docs/testing.md), not a measured constant.
 */
export const HIGH_FIT_THRESHOLD = 70;

export const isHighFit = (fitScore: number): boolean => fitScore >= HIGH_FIT_THRESHOLD;

/** Bounds on prose fields. A model that returns an essay is not answering the question asked. */
const MAX_RATIONALE = 1_200;
const MAX_GAP = 400;
const MAX_GAPS = 8;

const fail = (message: string, field: string, received: unknown): Result<never, ParseError> =>
  err(
    new ParseError(message, {
      field,
      received: typeof received === 'object' ? JSON.stringify(received) : String(received),
    }),
  );

const parse = (raw: unknown, allowedProgramAreas: readonly string[]): Result<FitAssessment, ParseError> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('the model response must be a JSON object', 'response', raw);
  }
  const value = raw as Record<string, unknown>;

  const fitScore = value['fitScore'];
  if (typeof fitScore !== 'number' || !Number.isInteger(fitScore) || fitScore < 0 || fitScore > 100) {
    return fail('fitScore must be an integer between 0 and 100', 'fitScore', fitScore);
  }

  const rationale = value['rationale'];
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    return fail('rationale must be a non-empty string', 'rationale', rationale);
  }
  if (rationale.length > MAX_RATIONALE) {
    return fail(`rationale must be at most ${MAX_RATIONALE} characters`, 'rationale', rationale.length);
  }

  const matched = value['matchedProgramAreas'];
  if (!Array.isArray(matched)) {
    return fail('matchedProgramAreas must be an array', 'matchedProgramAreas', matched);
  }

  // The menu, matched case-insensitively and returned in the menu's own spelling. Anything
  // outside it is a fabrication, and a fabrication fails the parse rather than being dropped:
  // silently discarding it would leave a score justified by an area nobody can check.
  const canonical = new Map(allowedProgramAreas.map((area) => [area.toLowerCase(), area]));
  const matchedProgramAreas: string[] = [];
  for (const area of matched) {
    if (typeof area !== 'string') {
      return fail('matchedProgramAreas must contain only strings', 'matchedProgramAreas', area);
    }
    const known = canonical.get(area.trim().toLowerCase());
    if (known === undefined) {
      return fail(
        `matchedProgramAreas must be chosen from: ${allowedProgramAreas.join(', ')}`,
        'matchedProgramAreas',
        area,
      );
    }
    if (!matchedProgramAreas.includes(known)) matchedProgramAreas.push(known);
  }

  const gaps = value['gaps'];
  if (!Array.isArray(gaps)) {
    return fail('gaps must be an array, empty if there are none', 'gaps', gaps);
  }
  if (gaps.length > MAX_GAPS) {
    return fail(`gaps must contain at most ${MAX_GAPS} entries`, 'gaps', gaps.length);
  }
  const cleanGaps: string[] = [];
  for (const gap of gaps) {
    if (typeof gap !== 'string' || gap.trim().length === 0) {
      return fail('gaps must contain only non-empty strings', 'gaps', gap);
    }
    if (gap.length > MAX_GAP) {
      return fail(`each gap must be at most ${MAX_GAP} characters`, 'gaps', gap.length);
    }
    cleanGaps.push(gap.trim());
  }

  return ok({ fitScore, rationale: rationale.trim(), matchedProgramAreas, gaps: cleanGaps });
};

/**
 * The shape the model is asked for, in the words it is asked in. It is part of the cache key,
 * so changing it invalidates every score derived from the old one -- which is correct: a
 * different question is a different answer.
 */
const responseContract = (allowedProgramAreas: readonly string[]): string =>
  [
    'Reply with JSON only, matching exactly this shape:',
    '{',
    '  "fitScore": <integer 0-100>,',
    '  "rationale": "<one paragraph, at most 1200 characters, citing the announcement\'s own purpose language>",',
    `  "matchedProgramAreas": [<zero or more, each chosen verbatim from: ${allowedProgramAreas.join(' | ')}>],`,
    '  "gaps": [<what this announcement asks for that the organisation cannot currently show>]',
    '}',
    'Do not invent a program area outside the list. Do not state a probability of winning.',
  ].join('\n');

export const FitAssessment = { parse, responseContract } as const;
