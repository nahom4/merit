import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Critique, revisionOrder } from './critique.js';
import { Rubric } from './rubric.js';

const RUBRIC = unwrapOrThrow(
  Rubric.parse({
    confidence: 0.9,
    totalPointsStated: 100,
    criteria: [
      { id: '1', name: 'Need', points: 60, subCriteria: ['States the need with current data'] },
      { id: '2', name: 'Approach', points: 40, subCriteria: ['States measurable objectives'] },
    ],
  }),
);

const DRAFT =
  'Cape Fear Literacy Council serves 412 adults a year in New Hanover County. ' +
  'Two thirds of them read below a fourth-grade level. ' +
  'We will enrol 120 new learners over the grant period.';

const wellFormed = {
  scores: [
    {
      criterionId: '1',
      score: 48,
      citedSentence: 'Two thirds of them read below a fourth-grade level.',
      comment: 'The need is stated with a figure, but the figure is not sourced to a year.',
    },
    {
      criterionId: '2',
      score: 12,
      citedSentence: 'We will enrol 120 new learners over the grant period.',
      comment: 'One output is stated. No outcome measure and no baseline.',
    },
  ],
};

describe('Critique.parse', () => {
  it('scores each criterion against the rubric’s own point values', () => {
    const result = Critique.parse(wellFormed, RUBRIC, DRAFT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.perCriterion).toHaveLength(2);
    expect(result.value.perCriterion[0]).toMatchObject({ criterionId: '1', score: 48, maxPoints: 60 });
    expect(result.value.totalScore).toBe(60);
    expect(result.value.totalPoints).toBe(100);
  });

  it('rejects a score whose cited sentence is not in the draft', () => {
    // The rule this whole module exists for. A fabricated citation is the one failure that
    // looks exactly like success: a plausible sentence, a plausible score, nothing behind it.
    const fabricated = {
      scores: [
        { ...wellFormed.scores[0], citedSentence: 'We are the largest literacy provider in the state.' },
        wellFormed.scores[1],
      ],
    };

    const result = Critique.parse(fabricated, RUBRIC, DRAFT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('does not appear in the draft');
    expect(result.error.context['field']).toBe('scores[].citedSentence');
  });

  it('rejects a score with no cited sentence at all', () => {
    const uncited = {
      scores: [{ ...wellFormed.scores[0], citedSentence: '' }, wellFormed.scores[1]],
    };

    expect(Critique.parse(uncited, RUBRIC, DRAFT).ok).toBe(false);
  });

  it('accepts a citation that differs only by whitespace, which a re-typed sentence does', () => {
    const rewrapped = {
      scores: [
        { ...wellFormed.scores[0], citedSentence: 'Two thirds of them read\n  below a fourth-grade level.' },
        wellFormed.scores[1],
      ],
    };

    expect(Critique.parse(rewrapped, RUBRIC, DRAFT).ok).toBe(true);
  });

  it('rejects a score above the points the rubric makes available', () => {
    // The ceiling comes from the rubric, never from the model: a critique that can award
    // itself 80 points on a 60-point criterion is not scoring, it is voting.
    const overScored = {
      scores: [{ ...wellFormed.scores[0], score: 80 }, wellFormed.scores[1]],
    };

    const result = Critique.parse(overScored, RUBRIC, DRAFT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('60');
  });

  it.each([
    ['a negative score', -1],
    ['a fractional score', 12.5],
    ['a score that is not a number', 'strong'],
  ])('rejects %s', (_case, score) => {
    expect(
      Critique.parse({ scores: [{ ...wellFormed.scores[0], score }, wellFormed.scores[1]] }, RUBRIC, DRAFT)
        .ok,
    ).toBe(false);
  });

  it('rejects a critique that skips a criterion', () => {
    const result = Critique.parse({ scores: [wellFormed.scores[0]] }, RUBRIC, DRAFT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('every criterion');
  });

  it('rejects a critique that scores a criterion the rubric does not contain', () => {
    const invented = {
      scores: [...wellFormed.scores, { ...wellFormed.scores[0], criterionId: '3' }],
    };

    const result = Critique.parse(invented, RUBRIC, DRAFT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('not in the rubric');
  });

  it('rejects a score with no comment saying what is wrong', () => {
    expect(
      Critique.parse(
        { scores: [{ ...wellFormed.scores[0], comment: '' }, wellFormed.scores[1]] },
        RUBRIC,
        DRAFT,
      ).ok,
    ).toBe(false);
  });

  it('accepts a zero, provided it still cites the sentence it is judging', () => {
    const zeroed = {
      scores: [
        wellFormed.scores[0],
        {
          criterionId: '2',
          score: 0,
          citedSentence: 'We will enrol 120 new learners over the grant period.',
          comment: 'This is an enrolment count, not a measurable objective. No outcome is stated.',
        },
      ],
    };

    const result = Critique.parse(zeroed, RUBRIC, DRAFT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.perCriterion[1]?.score).toBe(0);
  });
});

describe('revisionOrder', () => {
  it('revises where the most points are available, not where the score is lowest', () => {
    // Criterion 1 lost 12 of 60; criterion 2 lost 28 of 40. Criterion 2 is a worse score, and
    // it is also worth more to fix — 28 points against 12.
    const critique = unwrapOrThrow(Critique.parse(wellFormed, RUBRIC, DRAFT));

    expect(revisionOrder(critique).map((entry) => entry.criterionId)).toEqual(['2', '1']);
    expect(revisionOrder(critique)[0]?.pointsAtStake).toBe(28);
  });

  it('puts a criterion already at full marks last, whatever it is worth', () => {
    const perfect = {
      scores: [
        { ...wellFormed.scores[0], score: 60 },
        { ...wellFormed.scores[1], score: 20 },
      ],
    };
    const critique = unwrapOrThrow(Critique.parse(perfect, RUBRIC, DRAFT));

    expect(revisionOrder(critique).map((entry) => entry.criterionId)).toEqual(['2', '1']);
    expect(revisionOrder(critique)[1]?.pointsAtStake).toBe(0);
  });

  it('orders deterministically when two criteria have the same points at stake', () => {
    const tied = {
      scores: [
        { ...wellFormed.scores[0], score: 40 },
        { ...wellFormed.scores[1], score: 20 },
      ],
    };
    const critique = unwrapOrThrow(Critique.parse(tied, RUBRIC, DRAFT));

    // Both lose 20. The criterion worth more overall is the better bet, so it goes first.
    expect(revisionOrder(critique).map((entry) => entry.criterionId)).toEqual(['1', '2']);
  });
});
