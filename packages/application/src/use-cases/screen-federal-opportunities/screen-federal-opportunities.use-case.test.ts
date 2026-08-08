import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Organization, type FederalOpportunity } from '@merit/domain';
import { ScreenFederalOpportunities } from './screen-federal-opportunities.use-case.js';
import { InMemoryOpportunityRepository } from '../../testing/in-memory-opportunity.repository.js';
import { NeverCalledModelGateway, StubModelGateway } from '../../testing/stub-model.gateway.js';
import { StubRegistryStatusReader } from '../../testing/stub-registry-status.reader.js';
import { fixedClock } from '../../testing/fixed-id-generator.js';

const NOW = '2026-08-08T09:00:00.000Z';

const organization = unwrapOrThrow(
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

const opportunity = (overrides: Partial<FederalOpportunity> = {}): FederalOpportunity => ({
  id: '362839',
  number: 'HHS-2026-ACF-OCS-EAH-0027',
  title: 'Affordable Housing and Supportive Services Demonstration',
  agency: 'Administration for Children and Families - OCS',
  status: 'posted',
  openDate: '2026-07-25',
  closeDate: '2026-08-24',
  programNumbers: ['93.647'],
  programTitles: ['Social Services Research and Demonstration'],
  applicantTypeCodes: ['12'],
  eligibilityText: 'Applications from individuals and foreign entities are not eligible.',
  summary: 'Support services for residents of affordable housing.',
  fundingCategories: ['Income Security and Social Services'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachmentIds: ['344872'],
  ...overrides,
});

const goodAnswer = {
  fitScore: 74,
  rationale: 'The announcement funds supportive services, which this organisation delivers.',
  matchedProgramAreas: ['Income Security and Social Services'],
  gaps: ['No affordable housing partner is named in the profile.'],
};

const board = (
  opportunities: readonly FederalOpportunity[],
  model: StubModelGateway | NeverCalledModelGateway = StubModelGateway.answering(goodAnswer),
  registry = new StubRegistryStatusReader({ '581613254': 3 }),
) => {
  const repository = new InMemoryOpportunityRepository(opportunities);
  return {
    repository,
    model,
    useCase: new ScreenFederalOpportunities(repository, registry, model, fixedClock(NOW)),
  };
};

describe('ScreenFederalOpportunities', () => {
  it('screens then scores an opportunity this organisation may apply for', async () => {
    const { useCase } = board([opportunity()]);

    const result = await useCase.execute({ organization });

    expect(result.ok).toBe(true);
    const row = result.ok ? result.value.rows[0] : undefined;
    expect(row?.screening.outcome).toBe('eligible');
    expect(row?.fit?.fitScore).toBe(74);
    expect(row?.fitState).toBe('scored');
  });

  it('never asks a model about an opportunity the organisation cannot apply for', async () => {
    // The cascade's only real proof: a gateway that throws if it is called at all.
    const { useCase } = board(
      [
        opportunity({ id: '359816', number: 'PAR-25-003', applicantTypeCodes: ['00'] }),
        opportunity({ id: '2', applicantTypeCodes: ['13'] }),
      ],
      new NeverCalledModelGateway(),
    );

    const result = await useCase.execute({ organization });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.rows.map((row) => row.fitState) : []).toEqual([
      'not_applicable',
      'not_applicable',
    ]);
  });

  it('stores a readable reason on every rejection', async () => {
    const { useCase, repository } = board(
      [opportunity({ applicantTypeCodes: ['00'] })],
      new NeverCalledModelGateway(),
    );

    await useCase.execute({ organization });

    const stored = repository.storedAssessments()[0];
    expect(stored?.screening.rejections[0]?.reason).toContain('State governments');
  });

  it('scores an opportunity whose eligibility could not be fully decided, and says which check', async () => {
    const { useCase } = board(
      [opportunity()],
      StubModelGateway.answering(goodAnswer),
      // No registry row for this EIN: 501(c)(3) status unconfirmed.
      new StubRegistryStatusReader({}),
    );

    const result = await useCase.execute({ organization });
    const row = result.ok ? result.value.rows[0] : undefined;

    expect(row?.screening.outcome).toBe('indeterminate');
    expect(row?.screening.unresolved[0]?.rule).toBe('charity_status');
    expect(row?.fitState).toBe('scored');
  });

  it('queues the work instead of failing when the model quota is spent', async () => {
    const { useCase } = board([opportunity()], StubModelGateway.outOfQuota());

    const result = await useCase.execute({ organization });
    const row = result.ok ? result.value.rows[0] : undefined;

    expect(result.ok).toBe(true);
    expect(row?.fitState).toBe('queued');
    expect(row?.fitStateReason).toContain('quota');
    expect(row?.fit).toBeNull();
  });

  it('queues rather than storing an answer that failed its schema twice', async () => {
    const { useCase, repository } = board([opportunity()], StubModelGateway.answeringBadly());

    const result = await useCase.execute({ organization });

    expect(result.ok ? result.value.rows[0]?.fit : undefined).toBeNull();
    expect(repository.storedAssessments()[0]?.fit).toBeNull();
    expect(repository.storedAssessments()[0]?.fitStateReason).toContain('did not satisfy');
  });

  it('serves a persisted score rather than paying for it twice', async () => {
    const { useCase, model, repository } = board([opportunity()]);

    await useCase.execute({ organization });
    const second = await new ScreenFederalOpportunities(
      repository,
      new StubRegistryStatusReader({ '581613254': 3 }),
      new NeverCalledModelGateway(),
      fixedClock(NOW),
    ).execute({ organization });

    expect(model.requests.length).toBe(1);
    expect(second.ok ? second.value.rows[0]?.fit?.fitScore : 0).toBe(74);
  });

  it('re-scores when screening has changed since the stored assessment', async () => {
    const { useCase, repository, model } = board([opportunity()]);
    await useCase.execute({ organization });

    // The organisation moved. The stored score was for a different screening outcome, so it
    // is not reused: a cached judgement about a profile that no longer exists is a stale one.
    const moved = unwrapOrThrow(
      Organization.parse({
        id: 'org_1',
        name: 'Cape Fear Literacy Council',
        ein: '581613254',
        city: 'Memphis',
        state: 'TN',
        nteeCode: 'B60',
        annualRevenueDollars: 656_000,
      }),
    );
    await new ScreenFederalOpportunities(
      repository,
      new StubRegistryStatusReader({}),
      model,
      fixedClock(NOW),
    ).execute({ organization: moved });

    expect(model.requests.length).toBe(2);
  });

  it('spends at most the interactive budget on one pass, queueing the rest', async () => {
    const many = Array.from({ length: 9 }, (_, index) => opportunity({ id: `opp_${index}` }));
    const { useCase, model } = board(many);

    const result = await useCase.execute({ organization });

    expect(model.requests.length).toBe(5);
    const states = result.ok ? result.value.rows.map((row) => row.fitState) : [];
    expect(states.filter((state) => state === 'scored').length).toBe(5);
    expect(states.filter((state) => state === 'queued').length).toBe(4);
  });

  it('asks at interactive priority: a person is waiting on this screen', async () => {
    const { useCase, model } = board([opportunity()]);

    await useCase.execute({ organization });

    expect(model.requests[0]?.priority).toBe('interactive');
    expect(model.requests[0]?.purpose).toBe('fit_score');
  });

  it('puts the announcement and the organisation in the prompt', async () => {
    const { useCase, model } = board([opportunity()]);

    await useCase.execute({ organization });

    expect(model.requests[0]?.prompt).toContain('Cape Fear Literacy Council');
    expect(model.requests[0]?.prompt).toContain('Affordable Housing and Supportive Services');
  });

  it('ranks scored opportunities above unscored, and screened-out last', async () => {
    const { useCase } = board([
      opportunity({ id: 'rejected', applicantTypeCodes: ['00'] }),
      opportunity({ id: 'scored' }),
    ]);

    const result = await useCase.execute({ organization });

    expect(result.ok ? result.value.rows.map((row) => row.opportunity.id) : []).toEqual([
      'scored',
      'rejected',
    ]);
  });

  it('counts what it did, so the run can be shown rather than trusted', async () => {
    const { useCase } = board([
      opportunity({ id: 'a' }),
      opportunity({ id: 'b', applicantTypeCodes: ['00'] }),
    ]);

    const result = await useCase.execute({ organization });
    const coverage = result.ok ? result.value.coverage : null;

    expect(coverage?.opportunitiesConsidered).toBe(2);
    expect(coverage?.screenedOut).toBe(1);
    expect(coverage?.scored).toBe(1);
  });

  it('returns the registry failure rather than screening on a guess', async () => {
    const registry = new StubRegistryStatusReader({ '581613254': 3 });
    registry.failNextQuery();
    const { useCase } = board([opportunity()], StubModelGateway.answering(goodAnswer), registry);

    const result = await useCase.execute({ organization });

    expect(result.ok).toBe(false);
  });
});
