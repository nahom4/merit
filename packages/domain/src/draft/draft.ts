import { err, ok, ParseError, type Result } from '@merit/shared';
import type { Rubric } from './rubric.js';

/**
 * A draft application: one section per rubric criterion, plus an honest statement of what the
 * drafting was conditioned on.
 *
 * The conditioning is part of the value rather than metadata about it. A section written
 * against the announcement's actual scoring criteria and a section written against its summary
 * paragraph read identically and are worth very different amounts, and a user deciding how much
 * to rewrite has to be able to tell which one they are holding.
 */

export interface DraftSection {
  /** The rubric criterion this section is scored against, or null when the rubric was not
   *  trusted and the section was written from the announcement's summary instead. */
  readonly criterionId: string | null;
  readonly heading: string;
  readonly text: string;
  /** The sub-criteria this section was told to satisfy. Rendered beside it in the studio, so a
   *  user can see what the text was aiming at rather than guessing. */
  readonly subCriteria: readonly string[];
}

/**
 * What the draft was written against, and why — the roadmap's "**and say so**".
 *
 * `note` is user-facing prose, not a log line. It appears above the draft.
 */
export type DraftConditioning =
  | {
      readonly kind: 'rubric';
      readonly confidence: number;
      readonly note: string;
    }
  | {
      readonly kind: 'summary';
      readonly confidence: number;
      readonly note: string;
    };

export interface Draft {
  readonly opportunityId: string;
  readonly organizationId: string;
  readonly sections: readonly DraftSection[];
  readonly conditioning: DraftConditioning;
}

/** The one heading used when there is no trusted rubric to take headings from. */
export const SUMMARY_SECTION_HEADING = 'Narrative';

/**
 * States what the draft was conditioned on, in the words the user reads.
 *
 * Both branches say the same three things: what it was written against, how sure the extraction
 * was, and what the user should do about it. The low-confidence branch is not an apology — it is
 * an instruction, because a summary-conditioned draft needs the human to supply the criteria.
 */
export const conditioningFor = (rubric: Rubric | null, trusted: boolean): DraftConditioning => {
  if (rubric !== null && trusted) {
    return {
      kind: 'rubric',
      confidence: rubric.confidence,
      note:
        `Drafted against the ${rubric.criteria.length} review criteria extracted from the ` +
        `announcement, worth ${rubric.totalPoints} points in total. ${rubric.confidenceReason} ` +
        'Check the criteria against the announcement before you rely on them.',
    };
  }

  const because =
    rubric === null
      ? 'No review rubric could be read from the announcement’s documents.'
      : `A rubric was extracted but is not trusted. ${rubric.confidenceReason}`;

  return {
    kind: 'summary',
    confidence: rubric?.confidence ?? 0,
    note:
      `${because} This draft was written from the announcement’s summary instead, so it is not ` +
      'aimed at the criteria reviewers will actually score. Read the announcement’s review ' +
      'section and supply the criteria before submitting.',
  };
};

/** Bounds. A section is a section, not a book. */
const MAX_SECTION = 12_000;
const MIN_SECTION = 40;

/**
 * Splits prose into sentences.
 *
 * Deliberately naive: split on terminal punctuation followed by whitespace. It is used to check
 * that a critique's cited sentence is actually in the draft, and for that job over-splitting is
 * safe (a citation still matches a fragment) while under-splitting is safe too (the check is a
 * substring test, not an equality test). It is not a linguistics component and must not grow
 * into one.
 *
 * ponytail: regex split, not a sentence tokeniser — abbreviations like "Inc." over-split, which
 * costs nothing here. Reach for a real tokeniser only if sentence identity itself matters.
 */
export const sentencesOf = (text: string): readonly string[] =>
  text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/** Whitespace-insensitive comparison. A model re-typing a sentence it just wrote will differ by
 *  a line break or a double space, and failing a citation over that would be pedantry. */
export const normalizeForCitation = (text: string): string => text.replace(/\s+/gu, ' ').trim().toLowerCase();

const parse = (raw: unknown): Result<string, ParseError> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err(
      new ParseError('the model response must be a JSON object', {
        field: 'response',
        received: String(raw),
      }),
    );
  }
  const text = (raw as Record<string, unknown>)['text'];

  if (typeof text !== 'string' || text.trim().length === 0) {
    return err(new ParseError('text must be a non-empty string', { field: 'text', received: String(text) }));
  }
  if (text.trim().length < MIN_SECTION) {
    // A two-word section is a refusal wearing a section's clothes. Better to fail the call and
    // let the repair loop ask again than to persist it and render it as a draft.
    return err(
      new ParseError(`text must be at least ${MIN_SECTION} characters of actual draft`, {
        field: 'text',
        received: text.trim().length,
      }),
    );
  }
  if (text.length > MAX_SECTION) {
    return err(
      new ParseError(`text must be at most ${MAX_SECTION} characters`, {
        field: 'text',
        received: text.length,
      }),
    );
  }

  return ok(text.trim());
};

const responseContract = (): string =>
  [
    'Reply with JSON only, matching exactly this shape:',
    '{ "text": "<the section, in plain prose paragraphs, no markdown headings>" }',
    'Write only about this organisation, using only facts stated in the profile above.',
    'Do not invent a number, a partner, an outcome, or a named person.',
    'Where the section needs a fact the profile does not contain, write the sentence and mark',
    'the missing fact in square brackets, e.g. "[the number of adults served last year]".',
  ].join('\n');

export const DraftSection = { parse, responseContract } as const;
