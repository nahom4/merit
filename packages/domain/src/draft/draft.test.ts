import { describe, expect, it } from 'vitest';
import { conditioningFor, DraftSection, normalizeForCitation, sentencesOf } from './draft.js';
import { Rubric } from './rubric.js';
import { unwrapOrThrow } from '@merit/shared';

const rubric = (confidence: number, totalPointsStated: number | null = 100) =>
  unwrapOrThrow(
    Rubric.parse({
      confidence,
      totalPointsStated,
      criteria: [
        { id: '1', name: 'Need', points: 60, subCriteria: ['States the need with data'] },
        { id: '2', name: 'Approach', points: 40, subCriteria: ['States measurable objectives'] },
      ],
    }),
  );

describe('DraftSection.parse', () => {
  it('reads the drafted prose', () => {
    const result = DraftSection.parse({
      text: 'Cape Fear Literacy Council serves 412 adults a year. Two thirds read below a fourth-grade level.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('412 adults');
  });
});

describe('sentencesOf', () => {
  it('splits prose into the sentences a critique may cite', () => {
    expect(sentencesOf('One thing. Then another! And a third?')).toEqual([
      'One thing.',
      'Then another!',
      'And a third?',
    ]);
  });

  it('drops empty fragments rather than returning blanks a critique could "cite"', () => {
    expect(sentencesOf('  One thing.   \n\n  ')).toEqual(['One thing.']);
    expect(sentencesOf('   ')).toEqual([]);
  });
});

describe('normalizeForCitation', () => {
  it('ignores line breaks and repeated spaces, which a re-typed sentence differs by', () => {
    expect(normalizeForCitation('We  serve\n412 adults.')).toBe(normalizeForCitation('We serve 412 adults.'));
  });
});

describe('conditioningFor', () => {
  it('says the draft was written against the rubric, and how much it is worth', () => {
    const conditioning = conditioningFor(rubric(0.9), true);

    expect(conditioning.kind).toBe('rubric');
    expect(conditioning.note).toContain('2 review criteria');
    expect(conditioning.note).toContain('100 points');
  });

  it('says the rubric was not trusted, why, and what the human must now do', () => {
    // The roadmap's "**and say so**": a summary-conditioned draft that does not announce
    // itself is the failure this branch exists to prevent.
    const untrusted = rubric(0.9, 250);
    const conditioning = conditioningFor(untrusted, false);

    expect(conditioning.kind).toBe('summary');
    expect(conditioning.note).toContain('not trusted');
    expect(conditioning.note).toContain('150 points are unaccounted for');
    expect(conditioning.note).toContain('supply the criteria');
  });

  it('says so when no rubric could be read at all', () => {
    const conditioning = conditioningFor(null, false);

    expect(conditioning.kind).toBe('summary');
    expect(conditioning.confidence).toBe(0);
    expect(conditioning.note).toContain('No review rubric could be read');
  });
});

describe('DraftSection.parse', () => {
  it('rejects a section too short to be a draft rather than persisting a refusal', () => {
    expect(DraftSection.parse({ text: 'I cannot help.' }).ok).toBe(false);
  });

  it('rejects a missing or non-string text', () => {
    expect(DraftSection.parse({ text: '' }).ok).toBe(false);
    expect(DraftSection.parse({}).ok).toBe(false);
    expect(DraftSection.parse('some prose').ok).toBe(false);
  });

  it('tells the model to bracket a fact the profile does not contain rather than invent it', () => {
    expect(DraftSection.responseContract()).toContain('square');
    expect(DraftSection.responseContract()).toContain('Do not invent');
  });
});
