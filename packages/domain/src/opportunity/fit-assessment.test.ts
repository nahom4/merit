import { describe, expect, it } from 'vitest';
import { FitAssessment, HIGH_FIT_THRESHOLD, isHighFit } from './fit-assessment.js';

const ALLOWED = ['Education', 'Income Security and Social Services'];

const wellFormed = {
  fitScore: 72,
  rationale: 'The announcement funds adult literacy programming, which is this organisation’s core work.',
  matchedProgramAreas: ['Education'],
  gaps: ['No evaluation partner is named in the profile.'],
};

describe('FitAssessment.parse', () => {
  it('parses a well-formed model response', () => {
    const parsed = FitAssessment.parse(wellFormed, ALLOWED);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.value.fitScore : 0).toBe(72);
    expect(parsed.ok ? parsed.value.matchedProgramAreas : []).toEqual(['Education']);
  });

  it('rejects a score stated as a word rather than a number', () => {
    // The exact case the repair loop re-prompts on.
    const parsed = FitAssessment.parse({ ...wellFormed, fitScore: 'high' }, ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error.message).toContain('fitScore');
  });

  it('rejects a fractional score', () => {
    expect(FitAssessment.parse({ ...wellFormed, fitScore: 72.5 }, ALLOWED).ok).toBe(false);
  });

  it('rejects a score outside 0 to 100', () => {
    expect(FitAssessment.parse({ ...wellFormed, fitScore: 101 }, ALLOWED).ok).toBe(false);
    expect(FitAssessment.parse({ ...wellFormed, fitScore: -1 }, ALLOWED).ok).toBe(false);
  });

  it('accepts the boundaries', () => {
    expect(FitAssessment.parse({ ...wellFormed, fitScore: 0 }, ALLOWED).ok).toBe(true);
    expect(FitAssessment.parse({ ...wellFormed, fitScore: 100 }, ALLOWED).ok).toBe(true);
  });

  it('refuses a matched program area the organisation does not have', () => {
    // A fabricated area must not survive parsing: the model chooses from a set, it does not
    // invent one.
    const parsed = FitAssessment.parse(
      { ...wellFormed, matchedProgramAreas: ['Quantum Computing'] },
      ALLOWED,
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error.message).toContain('matchedProgramAreas');
  });

  it('accepts a matched area in different casing, in the spelling the menu used', () => {
    const parsed = FitAssessment.parse({ ...wellFormed, matchedProgramAreas: ['education'] }, ALLOWED);

    expect(parsed.ok ? parsed.value.matchedProgramAreas : []).toEqual(['Education']);
  });

  it('deduplicates a repeated matched area', () => {
    const parsed = FitAssessment.parse(
      { ...wellFormed, matchedProgramAreas: ['Education', 'Education'] },
      ALLOWED,
    );

    expect(parsed.ok ? parsed.value.matchedProgramAreas : []).toEqual(['Education']);
  });

  it('accepts a response that matched nothing', () => {
    const parsed = FitAssessment.parse({ ...wellFormed, fitScore: 4, matchedProgramAreas: [] }, ALLOWED);

    expect(parsed.ok).toBe(true);
  });

  it('rejects an empty rationale, because a score with no reasoning is a bare number', () => {
    expect(FitAssessment.parse({ ...wellFormed, rationale: '   ' }, ALLOWED).ok).toBe(false);
  });

  it('rejects a response with no gaps field at all', () => {
    const withoutGaps = { ...wellFormed } as Partial<typeof wellFormed>;
    delete withoutGaps.gaps;

    expect(FitAssessment.parse(withoutGaps, ALLOWED).ok).toBe(false);
  });

  it('accepts an empty gaps list, which is a claim the model is making', () => {
    expect(FitAssessment.parse({ ...wellFormed, gaps: [] }, ALLOWED).ok).toBe(true);
  });

  it('rejects a gap that is not a string', () => {
    expect(FitAssessment.parse({ ...wellFormed, gaps: [{ gap: 'no partner' }] }, ALLOWED).ok).toBe(false);
  });

  it('rejects anything that is not an object', () => {
    expect(FitAssessment.parse('72', ALLOWED).ok).toBe(false);
    expect(FitAssessment.parse(null, ALLOWED).ok).toBe(false);
  });

  it('names the offending field and value, so the repair loop can re-prompt with the error', () => {
    const parsed = FitAssessment.parse({ ...wellFormed, fitScore: 'high' }, ALLOWED);

    expect(parsed.ok ? {} : parsed.error.context).toMatchObject({ field: 'fitScore', received: 'high' });
  });
});

describe('FitAssessment.responseContract', () => {
  it('states the menu of program areas the model must choose from', () => {
    const contract = FitAssessment.responseContract(ALLOWED);

    expect(contract).toContain('Education');
    expect(contract).toContain('Income Security and Social Services');
  });
});

describe('isHighFit', () => {
  it('is high at the threshold and not below it', () => {
    expect(isHighFit(HIGH_FIT_THRESHOLD)).toBe(true);
    expect(isHighFit(HIGH_FIT_THRESHOLD - 1)).toBe(false);
  });
});
