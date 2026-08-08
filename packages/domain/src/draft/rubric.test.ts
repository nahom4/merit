import { describe, expect, it } from 'vitest';
import {
  isTrustworthy,
  reviewSectionOf,
  Rubric,
  RUBRIC_CONFIDENCE_THRESHOLD,
  selectRubricSource,
} from './rubric.js';

/**
 * A rubric is the announcement's own scoring sheet, read out of 60 pages of PDF by a model.
 * Everything here is about not believing it too easily.
 */

const wellFormed = {
  confidence: 0.9,
  totalPointsStated: 100,
  criteria: [
    {
      id: '1',
      name: 'Need and Significance',
      points: 40,
      subCriteria: [
        'Describes the target population with current data',
        'Explains why existing services do not meet the need',
      ],
    },
    {
      id: '2',
      name: 'Approach',
      points: 35,
      subCriteria: ['States measurable objectives'],
    },
    { id: '3', name: 'Organisational Capacity', points: 25, subCriteria: ['Names key personnel'] },
  ],
};

describe('Rubric.parse', () => {
  it('reads criteria, sub-criteria, and point values', () => {
    const result = Rubric.parse(wellFormed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criteria).toHaveLength(3);
    expect(result.value.criteria[0]?.name).toBe('Need and Significance');
    expect(result.value.criteria[0]?.points).toBe(40);
    expect(result.value.criteria[0]?.subCriteria).toHaveLength(2);
    expect(result.value.totalPoints).toBe(100);
  });

  it('keeps a high confidence when the criteria sum to the total the announcement states', () => {
    const result = Rubric.parse(wellFormed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidence).toBe(0.9);
    expect(isTrustworthy(result.value)).toBe(true);
    expect(result.value.confidenceReason).toContain('100 points');
  });

  it('caps a confident model when the points do not add up, and says how many are missing', () => {
    // The model says 0.95. The arithmetic says 15 points of criteria were missed. The
    // arithmetic wins: a self-reported confidence is a claim about fluency, not accuracy.
    const missing = {
      ...wellFormed,
      confidence: 0.95,
      criteria: wellFormed.criteria.slice(0, 2),
    };

    const result = Rubric.parse(missing);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalPoints).toBe(75);
    expect(result.value.confidence).toBeLessThan(RUBRIC_CONFIDENCE_THRESHOLD);
    expect(isTrustworthy(result.value)).toBe(false);
    expect(result.value.confidenceReason).toContain('25 points are unaccounted for');
  });

  it('caps confidence when the announcement states no total to check against', () => {
    const result = Rubric.parse({ ...wellFormed, totalPointsStated: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidence).toBeLessThan(RUBRIC_CONFIDENCE_THRESHOLD);
    expect(result.value.confidenceReason).toContain('cannot be checked');
  });

  it('never raises a low self-reported confidence, whatever the arithmetic says', () => {
    const result = Rubric.parse({ ...wellFormed, confidence: 0.2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidence).toBe(0.2);
  });

  it('rejects an extraction with no criteria rather than calling it low confidence', () => {
    // An empty rubric is a failed extraction, not an uncertain one. Returning it would send
    // drafting into a loop over nothing and call what came out a draft.
    const result = Rubric.parse({ ...wellFormed, criteria: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.context['field']).toBe('criteria');
  });

  it('rejects two criteria sharing one id, which would collapse their points', () => {
    const result = Rubric.parse({
      ...wellFormed,
      criteria: [wellFormed.criteria[0], { ...wellFormed.criteria[1], id: '1' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('share one id');
  });

  it.each([
    ['a non-integer point value', { points: 12.5 }],
    ['a zero point value', { points: 0 }],
    ['a negative point value', { points: -5 }],
    ['a missing name', { name: '' }],
    ['a missing id', { id: '  ' }],
    ['sub-criteria that are not an array', { subCriteria: 'describes the need' }],
  ])('rejects %s', (_case, override) => {
    const result = Rubric.parse({
      ...wellFormed,
      criteria: [{ ...wellFormed.criteria[0], ...override }],
    });

    expect(result.ok).toBe(false);
  });

  it.each([
    ['a confidence above one', 1.4],
    ['a negative confidence', -0.1],
    ['a confidence that is not a number', 'high'],
  ])('rejects %s', (_case, confidence) => {
    expect(Rubric.parse({ ...wellFormed, confidence }).ok).toBe(false);
  });

  it('rejects a response that is not an object', () => {
    expect(Rubric.parse(['1', '2']).ok).toBe(false);
    expect(Rubric.parse(null).ok).toBe(false);
    expect(Rubric.parse('a rubric').ok).toBe(false);
  });
});

describe('selectRubricSource', () => {
  const pdf = (id: string, fileName: string) => ({ id, fileName, mimeType: 'application/pdf' });

  it('picks the PDF and ignores the spreadsheets and templates beside it', () => {
    // The real shape of a "Full Announcement" folder: the NOFO, plus everything else.
    const chosen = selectRubricSource(
      [
        { id: '1', fileName: 'Budget Narrative Template.xlsx', mimeType: 'application/vnd.ms-excel' },
        pdf('2', 'HRSA-26-045 Final.pdf'),
      ],
      'HRSA-26-045',
    );

    expect(chosen?.id).toBe('2');
  });

  it('prefers the file named after the announcement over other PDFs in the folder', () => {
    const chosen = selectRubricSource(
      [pdf('1', 'TA Webinar Announcement (pre-recorded).pdf'), pdf('2', 'HRSA-26-045 Final.pdf')],
      'HRSA-26-045',
    );

    expect(chosen?.id).toBe('2');
  });

  it('skips a webinar flyer or a fillable form, which carry no rubric', () => {
    const chosen = selectRubricSource(
      [
        pdf('1', 'TA Webinar Announcement.pdf'),
        pdf('2', 'Statement of Interest Form fillable.pdf'),
        pdf('3', 'NOFO.pdf'),
      ],
      'ABC-1',
    );

    expect(chosen?.id).toBe('3');
  });

  it('trusts the file extension when the feed states no media type', () => {
    const chosen = selectRubricSource([{ id: '1', fileName: 'announcement.pdf', mimeType: '' }], 'ABC-1');

    expect(chosen?.id).toBe('1');
  });

  it('returns nothing when the announcement has no readable document, rather than guessing', () => {
    expect(selectRubricSource([], 'ABC-1')).toBeNull();
    expect(
      selectRubricSource(
        [{ id: '1', fileName: 'Proposal Template.docx', mimeType: 'application/msword' }],
        'ABC-1',
      ),
    ).toBeNull();
  });
});

describe('reviewSectionOf', () => {
  const filler = (label: string, times: number) => `${label} boilerplate paragraph. `.repeat(times);

  it('returns a short document whole rather than cutting it for no reason', () => {
    const short = 'Section I. Funding Opportunity Description. We fund adult literacy.';

    expect(reviewSectionOf(short, 5_000).text).toBe(short);
    expect(reviewSectionOf(short, 5_000).windowed).toBe(false);
  });

  it('windows a long document around the heading that names the review criteria', () => {
    const document =
      filler('front matter', 400) +
      'E. Application Review Information\n1. Criteria\nNeed and Significance (40 points)\n' +
      filler('back matter', 400);

    const found = reviewSectionOf(document, 4_000);

    expect(found.windowed).toBe(true);
    expect(found.text).toContain('Need and Significance (40 points)');
    expect(found.text.length).toBeLessThanOrEqual(4_000);
  });

  it('keeps context before the heading, where the point total is usually stated', () => {
    const document = `${filler('front', 400)}The total is 100 points. Application Review Information${filler('back', 400)}`;

    expect(reviewSectionOf(document, 4_000).text).toContain('The total is 100 points.');
  });

  it('falls back to the head of the document when no review heading is found, and says so', () => {
    // Not a silent truncation: the caller lowers its expectations, and the confidence check
    // catches an extraction made from the wrong 4,000 characters.
    const document = filler('nothing relevant here', 800);

    const found = reviewSectionOf(document, 4_000);

    expect(found.windowed).toBe(true);
    expect(found.headingFound).toBe(false);
    expect(found.text.length).toBeLessThanOrEqual(4_000);
  });
});

describe('Rubric.responseContract', () => {
  it('tells the model not to infer a criterion the document does not state', () => {
    expect(Rubric.responseContract()).toContain('Do not infer a criterion that is not written down');
  });
});
