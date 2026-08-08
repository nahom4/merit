import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { conditioningFor, Critique, Rubric, type FederalOpportunity } from '@merit/domain';
import type { DraftApplicationOutput, StoredDraft } from '@merit/application';
import { toDraftStudioView } from './view-model.js';

const RUBRIC = unwrapOrThrow(
  Rubric.parse({
    confidence: 0.9,
    totalPointsStated: 100,
    criteria: [
      { id: '1', name: 'Need', points: 60, subCriteria: ['States the need with data'] },
      { id: '2', name: 'Approach', points: 40, subCriteria: [] },
    ],
  }),
);

const SECTION_ONE = 'Cape Fear serves [the number of adults served last year] adults in Wilmington.';
const SECTION_TWO = 'It would enrol more learners.';
const DRAFT_TEXT = `1. Need\n${SECTION_ONE}\n\n2. Approach\n${SECTION_TWO}`;

const critique = (needScore: number, approachScore: number) =>
  unwrapOrThrow(
    Critique.parse(
      {
        scores: [
          {
            criterionId: '1',
            score: needScore,
            citedSentence: SECTION_ONE,
            comment: 'The figure is a placeholder the human has not filled.',
          },
          {
            criterionId: '2',
            score: approachScore,
            citedSentence: SECTION_TWO,
            comment: 'No measurable objective and no baseline.',
          },
        ],
      },
      RUBRIC,
      DRAFT_TEXT,
    ),
  );

const OPPORTUNITY = {
  id: '362839',
  number: 'HHS-2026-ACF-OCS-EAH-0027',
  title: 'Expanding Adult Housing Literacy',
} as FederalOpportunity;

const output = (overrides: Partial<StoredDraft> = {}): DraftApplicationOutput => ({
  opportunity: OPPORTUNITY,
  draft: {
    organizationId: 'org_1',
    targetId: '362839',
    targetKind: 'federal',
    rubric: RUBRIC,
    conditioning: conditioningFor(RUBRIC, true),
    sections: [
      { criterionId: '1', heading: '1. Need', text: SECTION_ONE, subCriteria: ['States the need with data'] },
      { criterionId: '2', heading: '2. Approach', text: SECTION_TWO, subCriteria: [] },
    ],
    critiqueBefore: critique(20, 10),
    critiqueAfter: critique(40, 10),
    revisedCriterionIds: ['1'],
    note: null,
    draftedAt: '2026-08-08T10:00:00.000Z',
    ...overrides,
  },
});

const view = (overrides: Partial<StoredDraft> = {}) =>
  toDraftStudioView(output(overrides), 'Cape Fear Literacy Council', 'org_1');

describe('toDraftStudioView', () => {
  it('states what the draft was conditioned on, above the draft', () => {
    expect(view().conditioning.kind).toBe('rubric');
    expect(view().conditioning.note).toContain('2 review criteria');
  });

  it('says so plainly when the draft was written without a trusted rubric', () => {
    const summary = view({
      rubric: null,
      conditioning: conditioningFor(null, false),
      sections: [{ criterionId: null, heading: 'Narrative', text: SECTION_ONE, subCriteria: [] }],
      critiqueBefore: null,
      critiqueAfter: null,
      revisedCriterionIds: [],
    });

    expect(summary.conditioning.kind).toBe('summary');
    expect(summary.conditioning.note).toContain('No review rubric could be read');
    expect(summary.critiqueEmptyReason).toContain('could not be read');
  });

  it('shows each criterion’s score before and after, with the sentence it cites', () => {
    const criterion = view().criteria[0];

    expect(criterion?.before).toBe('20/60');
    expect(criterion?.after).toBe('40/60');
    expect(criterion?.movement).toBe('improved');
    // The product rule: a score never renders alone. The citation was verified to be in the
    // draft before it was stored, so a user can check the judgement rather than trust it.
    expect(criterion?.citedSentence).toBe(SECTION_ONE);
  });

  it('scales each bar against its own criterion, not against the whole rubric', () => {
    // 40 of 60 is 67%, not 40% of the 100-point total. A bar scaled against the rubric makes a
    // strong score on a small criterion look like a weak one.
    expect(view().criteria[0]?.afterPercent).toBe(67);
  });

  it('reports a revision that gained points', () => {
    expect(view().revisionSummary).toContain('a gain of 20 points');
  });

  it('reports a revision that changed nothing rather than implying it helped', () => {
    const flat = view({ critiqueAfter: critique(20, 10) });

    expect(flat.revisionSummary).toContain('did not move the score');
    expect(flat.criteria[0]?.movement).toBe('unchanged');
  });

  it('reports a revision that made the draft worse, and says which wording to prefer', () => {
    // A model asked to improve its own text does not always improve it. A studio that only ever
    // shows improvement is showing the intention, not the result.
    const worse = view({ critiqueAfter: critique(10, 10) });

    expect(worse.revisionSummary).toContain('moved the score down');
    expect(worse.revisionSummary).toContain('Prefer the earlier wording');
    expect(worse.criteria[0]?.movement).toBe('worsened');
  });

  it('says when nothing was revised, rather than leaving the section blank', () => {
    const untouched = view({ revisedCriterionIds: [], critiqueAfter: critique(20, 10) });

    expect(untouched.revisionSummary).toContain('No section was revised');
  });

  it('flags weak criteria with what the human must supply', () => {
    const weak = view().weakCriteria;

    // Approach scores 10 of 40 after revision, so it is the weakest and leads.
    expect(weak[0]?.criterionName).toBe('Approach');
    expect(weak[0]?.pointsAtStake).toBe('30 of 40 points still unearned');
    expect(weak[0]?.whatToSupply).toContain('No measurable objective');
  });

  it('measures weakness on the revised draft, not on the text revision already fixed', () => {
    // Need goes 20/60 -> 55/60. Flagging it after the revision pass fixed it would send the
    // human to the wrong section.
    const fixed = view({ critiqueAfter: critique(55, 10) });

    expect(fixed.weakCriteria.map((entry) => entry.criterionName)).not.toContain('Need');
  });

  it('pulls out the bracketed gaps the drafting left for the human', () => {
    const placeholders = view().sections[0]?.placeholders;

    expect(placeholders).toEqual(['[the number of adults served last year]']);
  });

  it('shows the sub-criteria a section was written to answer', () => {
    expect(view().sections[0]?.subCriteria).toEqual(['States the need with data']);
    expect(view().sections[0]?.subCriteriaNote).toContain('a reviewer is told to look for');
  });

  it('says the announcement states no sub-criteria rather than showing an empty list', () => {
    expect(view().sections[1]?.subCriteriaNote).toContain('no sub-criteria');
  });

  it('marks which sections revision actually rewrote', () => {
    expect(view().sections[0]?.wasRevised).toBe(true);
    expect(view().sections[1]?.wasRevised).toBe(false);
  });

  it('renders a partial run’s note rather than swallowing it', () => {
    const partial = view({ note: 'Drafting stopped after 1 of 2 sections: the daily quota is spent.' });

    expect(partial.note).toContain('the daily quota is spent');
  });

  it('keeps the first critique’s scores when the revised draft could not be re-scored', () => {
    const unscored = view({ critiqueAfter: null });

    expect(unscored.totalAfter).toBeNull();
    expect(unscored.criteria[0]?.movement).toBe('not_rescored');
    expect(unscored.revisionSummary).toContain('could not be re-scored');
  });
});
