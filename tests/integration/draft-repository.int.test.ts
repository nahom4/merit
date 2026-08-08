import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { conditioningFor, Critique, Rubric } from '@merit/domain';
import type { StoredDraft } from '@merit/application';
import { LibsqlDraftRepository } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

/**
 * Real libSQL, real migrations (ADR 0002). What is proved here is that the JSON columns survive
 * a round trip as the values that went in — a rubric with its confidence reason, a critique with
 * its cited sentences — and that re-drafting replaces rather than accumulating.
 */
let database: FreshDatabase;

beforeAll(async () => {
  database = await freshDatabase();
});

afterAll(async () => {
  await database.destroy();
});

const RUBRIC = unwrapOrThrow(
  Rubric.parse({
    confidence: 0.9,
    totalPointsStated: 100,
    criteria: [
      { id: '1', name: 'Need', points: 60, subCriteria: ['States the need with data'] },
      { id: '2', name: 'Approach', points: 40, subCriteria: ['States measurable objectives'] },
    ],
  }),
);

const DRAFT_TEXT = 'Cape Fear Literacy Council serves adults in Wilmington. It would enrol more.';

const CRITIQUE = unwrapOrThrow(
  Critique.parse(
    {
      scores: [
        {
          criterionId: '1',
          score: 30,
          citedSentence: 'Cape Fear Literacy Council serves adults in Wilmington.',
          comment: 'Asserted, not evidenced.',
        },
        {
          criterionId: '2',
          score: 20,
          citedSentence: 'It would enrol more.',
          comment: 'No measurable objective.',
        },
      ],
    },
    RUBRIC,
    DRAFT_TEXT,
  ),
);

const draft = (overrides: Partial<StoredDraft> = {}): StoredDraft => ({
  organizationId: 'org_1',
  targetId: '362839',
  targetKind: 'federal',
  rubric: RUBRIC,
  conditioning: conditioningFor(RUBRIC, true),
  sections: [
    {
      criterionId: '1',
      heading: '1. Need',
      text: 'Cape Fear Literacy Council serves adults in Wilmington.',
      subCriteria: ['States the need with data'],
    },
    { criterionId: '2', heading: '2. Approach', text: 'It would enrol more.', subCriteria: [] },
  ],
  critiqueBefore: CRITIQUE,
  critiqueAfter: CRITIQUE,
  revisedCriterionIds: ['1'],
  note: null,
  draftedAt: '2026-08-08T10:00:00.000Z',
  ...overrides,
});

const repository = () => new LibsqlDraftRepository(database.db);

describe('LibsqlDraftRepository', () => {
  it('round-trips a draft with its rubric, sections, and both critiques', async () => {
    const saved = await repository().saveDraft(draft());
    expect(saved.ok).toBe(true);

    const loaded = await repository().findDraft('org_1', '362839');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.rubric?.criteria).toHaveLength(2);
    expect(loaded.value.rubric?.confidenceReason).toContain('100 points');
    expect(loaded.value.sections[0]?.subCriteria).toEqual(['States the need with data']);
    expect(loaded.value.critiqueBefore?.totalScore).toBe(50);
    expect(loaded.value.critiqueAfter?.totalPoints).toBe(100);
    expect(loaded.value.revisedCriterionIds).toEqual(['1']);
    expect(loaded.value.draftedAt).toBe('2026-08-08T10:00:00.000Z');
  });

  it('keeps the conditioning the draft was actually written under', async () => {
    // Never recomputed at read time: a draft written last week under a since-changed threshold
    // must still report the basis it was written on, not today's answer to the same question.
    await repository().saveDraft(draft());

    const loaded = await repository().findDraft('org_1', '362839');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.conditioning.kind).toBe('rubric');
    expect(loaded.value.conditioning.confidence).toBe(0.9);
    expect(loaded.value.conditioning.note).toContain('2 review criteria');
  });

  it('replaces on re-draft rather than accumulating versions', async () => {
    await repository().saveDraft(draft({ targetId: 'replace-me' }));
    await repository().saveDraft(
      draft({ targetId: 'replace-me', note: 'The quota ran out.', critiqueAfter: null }),
    );

    const loaded = await repository().findDraft('org_1', 'replace-me');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.note).toBe('The quota ran out.');
    expect(loaded.value.critiqueAfter).toBeNull();
  });

  it('stores a summary-conditioned draft with no rubric and no critique', async () => {
    // The degraded path has to survive persistence too, and "no rubric" must come back as null
    // rather than as an empty rubric that reads like a successful extraction.
    await repository().saveDraft(
      draft({
        targetId: 'no-rubric',
        rubric: null,
        conditioning: conditioningFor(null, false),
        sections: [{ criterionId: null, heading: 'Narrative', text: 'A general case.', subCriteria: [] }],
        critiqueBefore: null,
        critiqueAfter: null,
        revisedCriterionIds: [],
        note: 'The announcement’s document could not be read.',
      }),
    );

    const loaded = await repository().findDraft('org_1', 'no-rubric');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.rubric).toBeNull();
    expect(loaded.value.conditioning.kind).toBe('summary');
    expect(loaded.value.sections[0]?.criterionId).toBeNull();
  });

  it('reports a draft that does not exist as null, not as an error', async () => {
    const loaded = await repository().findDraft('org_1', 'never-drafted');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toBeNull();
  });

  it('keeps one organisation’s draft separate from another’s for the same announcement', async () => {
    await repository().saveDraft(draft({ organizationId: 'org_a', targetId: 'shared' }));
    await repository().saveDraft(
      draft({ organizationId: 'org_b', targetId: 'shared', note: 'org_b’s note' }),
    );

    const a = await repository().findDraft('org_a', 'shared');
    const b = await repository().findDraft('org_b', 'shared');

    expect(a.ok && a.value?.note).toBeNull();
    expect(b.ok && b.value?.note).toBe('org_b’s note');
  });
});
