import { describe, expect, it } from 'vitest';
import { err, ok, unwrapOrThrow } from '@merit/shared';
import { Organization, type FederalOpportunity } from '@merit/domain';
import { DraftApplication } from './draft-application.use-case.js';
import { DocumentUnavailable, ModelUnavailable } from '../../errors.js';
import { StubModelGateway } from '../../testing/stub-model.gateway.js';
import { InMemoryDraftRepository } from '../../testing/in-memory-draft.repository.js';
import { InMemoryOpportunityRepository } from '../../testing/in-memory-opportunity.repository.js';
import type { AnnouncementDocumentGateway } from '../../ports/announcement-document.port.js';

const ORGANIZATION = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '581613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 656_000,
  }),
);

const OPPORTUNITY: FederalOpportunity = {
  id: '362839',
  number: 'HHS-2026-ACF-OCS-EAH-0027',
  title: 'Expanding Adult Housing Literacy',
  agency: 'Administration for Children and Families',
  status: 'posted',
  openDate: '2026-07-24',
  closeDate: '2026-08-24',
  programNumbers: ['93.569'],
  programTitles: ['Community Services Block Grant'],
  applicantTypeCodes: ['12'],
  eligibilityText: 'Nonprofits having a 501(c)(3) status with the IRS.',
  summary: 'Supports adult literacy services that lead to stable housing.',
  fundingCategories: ['Education'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachments: [{ id: '354136', fileName: 'hhs-2026-acf-ocs-eah-0027.pdf', mimeType: 'application/pdf' }],
};

/** A document whose review section names two criteria summing to the total it states. */
const NOFO_TEXT = [
  'Section I. Funding Opportunity Description.',
  'ACF supports adult literacy services.',
  'Section V. Application Review Information. Applications are scored out of 100 points.',
  '1. Need and Significance ......... 60 points',
  '2. Approach ..................... 40 points',
].join('\n');

const RUBRIC_REPLY = {
  confidence: 0.9,
  totalPointsStated: 100,
  criteria: [
    { id: '1', name: 'Need and Significance', points: 60, subCriteria: ['States the need with data'] },
    { id: '2', name: 'Approach', points: 40, subCriteria: ['States measurable objectives'] },
  ],
};

const SECTION_TEXT =
  'Cape Fear Literacy Council serves adults in Wilmington, North Carolina. ' +
  'It would enrol [the number of new learners] over the grant period.';

/** Answers each purpose with the shape that purpose's parse demands. The critique cites a
 *  sentence that really is in the drafted text, so it survives the real validator. */
const scriptedModel = (options: { readonly scoreOutOf60?: number } = {}) =>
  new StubModelGateway((request) => {
    if (request.purpose === 'rubric') return { kind: 'raw', raw: RUBRIC_REPLY };
    if (request.purpose === 'draft_section' || request.purpose === 'revise_section') {
      return { kind: 'raw', raw: { text: SECTION_TEXT } };
    }
    if (request.purpose === 'critique') {
      return {
        kind: 'raw',
        raw: {
          scores: [
            {
              criterionId: '1',
              score: options.scoreOutOf60 ?? 30,
              citedSentence: 'Cape Fear Literacy Council serves adults in Wilmington, North Carolina.',
              comment: 'The need is asserted, not evidenced. No figure for the population served.',
            },
            {
              criterionId: '2',
              score: 30,
              citedSentence: 'It would enrol [the number of new learners] over the grant period.',
              comment: 'The enrolment target is a placeholder the human has not filled.',
            },
          ],
        },
      };
    }
    throw new Error(`unexpected model purpose: ${request.purpose}`);
  });

const documentsReturning = (text: string): AnnouncementDocumentGateway => ({
  fetchText: async () => ok(text),
});

const documentsFailing = (): AnnouncementDocumentGateway => ({
  fetchText: async () =>
    err(new DocumentUnavailable('the attachment has no text layer', { attachmentId: '354136' })),
});

const build = (
  options: {
    readonly model?: StubModelGateway;
    readonly documents?: AnnouncementDocumentGateway;
    readonly opportunity?: FederalOpportunity;
  } = {},
) => {
  const opportunities = new InMemoryOpportunityRepository([options.opportunity ?? OPPORTUNITY]);
  const drafts = new InMemoryDraftRepository();
  const model = options.model ?? scriptedModel();

  return {
    drafts,
    model,
    useCase: new DraftApplication(
      opportunities,
      drafts,
      options.documents ?? documentsReturning(NOFO_TEXT),
      model,
      { now: () => new Date('2026-08-08T10:00:00Z') },
    ),
  };
};

const run = async (built: ReturnType<typeof build>) =>
  built.useCase.execute({ organization: ORGANIZATION, opportunityId: OPPORTUNITY.id });

describe('DraftApplication', () => {
  it('drafts one section per rubric criterion, conditioned on that criterion’s sub-criteria', async () => {
    const built = build();

    const result = await run(built);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.sections).toHaveLength(2);
    expect(result.value.draft.sections[0]?.criterionId).toBe('1');
    expect(result.value.draft.sections[0]?.subCriteria).toEqual(['States the need with data']);

    // The section prompt carries the sub-criteria the section is scored against. Drafting that
    // is not conditioned on them is the failure this whole slice exists to avoid.
    const sectionPrompt = built.model.requests.find((request) => request.purpose === 'draft_section');
    expect(sectionPrompt?.prompt).toContain('States the need with data');
    expect(sectionPrompt?.prompt).toContain('60 of 100 points');
  });

  it('says it drafted against the rubric, and how confident the extraction was', async () => {
    const result = await run(build());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.conditioning.kind).toBe('rubric');
    expect(result.value.draft.conditioning.note).toContain('2 review criteria');
  });

  it('falls back to summary-conditioned drafting when the rubric is not trusted, and says so', async () => {
    // The criteria sum to 75 against a stated 100. The arithmetic caps the confidence below the
    // threshold whatever the model claims, and drafting must not proceed against it.
    const model = new StubModelGateway((request) => {
      if (request.purpose === 'rubric') {
        return {
          kind: 'raw',
          raw: { ...RUBRIC_REPLY, confidence: 0.99, criteria: [RUBRIC_REPLY.criteria[0]] },
        };
      }
      return { kind: 'raw', raw: { text: SECTION_TEXT } };
    });

    const result = await run(build({ model }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.conditioning.kind).toBe('summary');
    expect(result.value.draft.conditioning.note).toContain('not trusted');
    expect(result.value.draft.sections).toHaveLength(1);
    expect(result.value.draft.sections[0]?.criterionId).toBeNull();
    // An untrusted rubric buys no critique: there is nothing credible to score against.
    expect(result.value.draft.critiqueBefore).toBeNull();
    expect(model.requests.filter((request) => request.purpose === 'critique')).toHaveLength(0);
  });

  it('falls back and says so when the announcement has no readable document', async () => {
    const result = await run(build({ documents: documentsFailing() }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.conditioning.kind).toBe('summary');
    expect(result.value.draft.note).toContain('no text layer');
  });

  it('falls back when the announcement has no document worth reading at all', async () => {
    const noPdf = { ...OPPORTUNITY, attachments: [] };
    const built = build({ opportunity: noPdf });

    const result = await run(built);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.conditioning.kind).toBe('summary');
    expect(result.value.draft.conditioning.note).toContain('No review rubric could be read');
    // Nothing was downloaded and no rubric call was made: there was nothing to read.
    expect(built.model.requests.filter((request) => request.purpose === 'rubric')).toHaveLength(0);
  });

  it('critiques every criterion and revises where the most points are available', async () => {
    const built = build();

    const result = await run(built);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Criterion 1 lost 30 of 60; criterion 2 lost 10 of 40. Criterion 1 is revised first.
    expect(result.value.draft.revisedCriterionIds[0]).toBe('1');
    expect(result.value.draft.critiqueBefore?.perCriterion).toHaveLength(2);
    expect(result.value.draft.critiqueAfter?.perCriterion).toHaveLength(2);
  });

  it('scores the draft before and after revision, so revision can be checked rather than trusted', async () => {
    const result = await run(build());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.critiqueBefore?.totalScore).toBe(60);
    expect(result.value.draft.critiqueAfter?.totalScore).toBe(60);
    expect(result.value.draft.critiqueBefore?.totalPoints).toBe(100);
  });

  it('never spends a revision call on a criterion already at full marks', async () => {
    const built = build({ model: scriptedModel({ scoreOutOf60: 60 }) });

    const result = await run(built);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.revisedCriterionIds).not.toContain('1');
  });

  it('keeps the sections it managed to draft when the quota runs out mid-run', async () => {
    // Degradation, not failure: the rubric is extracted, the first section is drafted, and the
    // quota is spent. What exists is saved with a note, because half a draft and an explanation
    // beats losing the model calls already paid for.
    let calls = 0;
    const model = new StubModelGateway((request) => {
      calls += 1;
      if (request.purpose === 'rubric') return { kind: 'raw', raw: RUBRIC_REPLY };
      if (calls > 2) {
        return {
          kind: 'error',
          error: new ModelUnavailable('the daily model quota is spent', { reason: 'daily_quota' }),
        };
      }
      return { kind: 'raw', raw: { text: SECTION_TEXT } };
    });

    const built = build({ model });
    const result = await run(built);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.sections).toHaveLength(1);
    expect(result.value.draft.note).toContain('quota');
    expect(result.value.draft.critiqueBefore).toBeNull();

    // And it was persisted, so the calls already spent are not lost on the next page load.
    const saved = await built.drafts.findDraft('org_1', OPPORTUNITY.id);
    expect(saved.ok && saved.value?.sections).toHaveLength(1);
  });

  it('rejects a critique that cites a sentence not in the draft rather than storing it', async () => {
    const model = new StubModelGateway((request) => {
      if (request.purpose === 'rubric') return { kind: 'raw', raw: RUBRIC_REPLY };
      if (request.purpose === 'critique') {
        return {
          kind: 'raw',
          raw: {
            scores: RUBRIC_REPLY.criteria.map((criterion) => ({
              criterionId: criterion.id,
              score: 10,
              citedSentence: 'We are the largest literacy provider in the state.',
              comment: 'Fabricated.',
            })),
          },
        };
      }
      return { kind: 'raw', raw: { text: SECTION_TEXT } };
    });

    const result = await run(build({ model }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No critique is better than one whose scores point at sentences nobody wrote.
    expect(result.value.draft.critiqueBefore).toBeNull();
    expect(result.value.draft.note).toContain('does not appear in the draft');
  });

  it('reports an opportunity it has never swept rather than drafting against nothing', async () => {
    const built = build();

    const result = await built.useCase.execute({
      organization: ORGANIZATION,
      opportunityId: 'not-a-real-id',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_found');
  });

  it('serves the stored draft on a reload rather than re-buying every model call', async () => {
    // Drafting a three-criterion rubric costs eight model calls. A page that re-drafts on every
    // load spends the daily quota on refreshes, so a complete stored draft is served as-is.
    const built = build();
    await run(built);
    const spentFirstTime = built.model.requests.length;
    expect(spentFirstTime).toBeGreaterThan(1);

    const again = await run(built);

    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(built.model.requests).toHaveLength(spentFirstTime);
    expect(again.value.draft.sections).toHaveLength(2);
  });

  it('re-drafts a partial draft, because the reason it was partial may have passed', async () => {
    // A draft cut short by a spent quota is not a draft to serve for ever. Tomorrow the quota
    // is back, and the user asking again is asking for the rest of it.
    let quotaSpent = true;
    const model = new StubModelGateway((request) => {
      if (request.purpose === 'rubric') return { kind: 'raw', raw: RUBRIC_REPLY };
      if (quotaSpent) {
        return {
          kind: 'error',
          error: new ModelUnavailable('the daily model quota is spent', { reason: 'daily_quota' }),
        };
      }
      if (request.purpose === 'critique') return { kind: 'raw', raw: { scores: [] } };
      return { kind: 'raw', raw: { text: SECTION_TEXT } };
    });

    const built = build({ model });
    const partial = await run(built);
    expect(partial.ok && partial.value.draft.note).toContain('quota');

    quotaSpent = false;
    const retried = await run(built);

    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.draft.sections).toHaveLength(2);
  });

  it('persists the draft so a reload does not re-buy every model call', async () => {
    const built = build();
    await run(built);

    const saved = await built.drafts.findDraft('org_1', OPPORTUNITY.id);

    expect(saved.ok).toBe(true);
    if (!saved.ok || saved.value === null) return;
    expect(saved.value.sections).toHaveLength(2);
    expect(saved.value.targetKind).toBe('federal');
    expect(saved.value.draftedAt).toBe('2026-08-08T10:00:00.000Z');
  });
});
