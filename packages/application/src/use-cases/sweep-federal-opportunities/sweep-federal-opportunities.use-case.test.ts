import { describe, expect, it } from 'vitest';
import type { FederalOpportunity } from '@merit/domain';
import { SweepFederalOpportunities } from './sweep-federal-opportunities.use-case.js';
import { InMemoryOpportunityRepository } from '../../testing/in-memory-opportunity.repository.js';
import { StubOpportunityGateway } from '../../testing/stub-opportunity.gateway.js';
import { fixedClock, fixedIdGenerator } from '../../testing/fixed-id-generator.js';

const opportunity = (id: string, number: string): FederalOpportunity => ({
  id,
  number,
  title: `Announcement ${number}`,
  agency: 'Administration for Children and Families',
  status: 'posted',
  openDate: '2026-07-25',
  closeDate: '2026-08-24',
  programNumbers: ['93.647'],
  programTitles: ['Social Services Research and Demonstration'],
  applicantTypeCodes: ['12'],
  eligibilityText: 'Nonprofits may apply.',
  summary: 'A summary.',
  fundingCategories: ['Income Security and Social Services'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachments: [{ id: '344872', fileName: 'nofo.pdf', mimeType: 'application/pdf' }],
});

const NOW = '2026-08-08T06:00:00.000Z';

const hit = (id: string, number: string) => ({
  id,
  number,
  title: `Announcement ${number}`,
  agency: 'Administration for Children and Families',
});

const sweep = (gateway: StubOpportunityGateway, repository = new InMemoryOpportunityRepository()) => ({
  repository,
  gateway,
  useCase: new SweepFederalOpportunities(gateway, repository, fixedClock(NOW), fixedIdGenerator('sweep_1')),
});

describe('SweepFederalOpportunities', () => {
  it('searches each keyword and stores the detail behind every hit', async () => {
    const gateway = new StubOpportunityGateway(
      { literacy: [hit('1', 'A-1')], housing: [hit('2', 'A-2')] },
      { 1: opportunity('1', 'A-1'), 2: opportunity('2', 'A-2') },
    );
    const { useCase, repository } = sweep(gateway);

    const result = await useCase.execute({ keywords: ['literacy', 'housing'], perKeyword: 10 });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.opportunitiesInserted : 0).toBe(2);
    const stored = await repository.listOpportunities(10);
    expect(stored.ok ? stored.value.map((row) => row.number).sort() : []).toEqual(['A-1', 'A-2']);
  });

  it('fetches an opportunity once when two searches return it', async () => {
    const gateway = new StubOpportunityGateway(
      { literacy: [hit('1', 'A-1')], adults: [hit('1', 'A-1')] },
      { 1: opportunity('1', 'A-1') },
    );
    const { useCase } = sweep(gateway);

    await useCase.execute({ keywords: ['literacy', 'adults'], perKeyword: 10 });

    expect(gateway.fetched).toEqual(['1']);
  });

  it('is idempotent: sweeping twice leaves one row, counted as an update', async () => {
    const gateway = new StubOpportunityGateway(
      { literacy: [hit('1', 'A-1')] },
      { 1: opportunity('1', 'A-1') },
    );
    const { useCase, repository } = sweep(gateway);

    await useCase.execute({ keywords: ['literacy'], perKeyword: 10 });
    const second = await useCase.execute({ keywords: ['literacy'], perKeyword: 10 });

    expect(second.ok ? second.value.opportunitiesInserted : -1).toBe(0);
    expect(second.ok ? second.value.opportunitiesUpdated : -1).toBe(1);
    const stored = await repository.listOpportunities(10);
    expect(stored.ok ? stored.value.length : 0).toBe(1);
  });

  it('counts an unreadable detail as a parse fault and keeps going', async () => {
    const gateway = new StubOpportunityGateway(
      { literacy: [hit('1', 'A-1'), hit('2', 'A-2')] },
      { 2: opportunity('2', 'A-2') },
      { fetches: ['1'] },
    );
    const { useCase } = sweep(gateway);

    const result = await useCase.execute({ keywords: ['literacy'], perKeyword: 10 });

    expect(result.ok ? result.value.parseFaults : 0).toBe(1);
    expect(result.ok ? result.value.opportunitiesInserted : 0).toBe(1);
  });

  it('counts a failed search as a fault and sweeps the keywords that worked', async () => {
    const gateway = new StubOpportunityGateway(
      { literacy: [hit('1', 'A-1')], housing: [hit('2', 'A-2')] },
      { 1: opportunity('1', 'A-1'), 2: opportunity('2', 'A-2') },
      { searches: ['housing'] },
    );
    const { useCase } = sweep(gateway);

    const result = await useCase.execute({ keywords: ['literacy', 'housing'], perKeyword: 10 });

    expect(result.ok ? result.value.opportunitiesInserted : 0).toBe(1);
    expect(result.ok ? result.value.parseFaults : 0).toBe(1);
  });

  it('fails when the feed could not be read at all, rather than reporting an empty sweep', async () => {
    const gateway = new StubOpportunityGateway({}, {}, { searches: ['literacy', 'housing'] });
    const { useCase } = sweep(gateway);

    const result = await useCase.execute({ keywords: ['literacy', 'housing'], perKeyword: 10 });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.code).toBe('opportunity_source_unavailable');
  });

  it('records the run so the numbers can be shown rather than trusted', async () => {
    const gateway = new StubOpportunityGateway(
      { literacy: [hit('1', 'A-1')] },
      { 1: opportunity('1', 'A-1') },
    );
    const { useCase, repository } = sweep(gateway);

    await useCase.execute({ keywords: ['literacy'], perKeyword: 10 });

    const run = await repository.latestSweep();
    expect(run.ok ? run.value?.hitsSeen : null).toBe(1);
    expect(run.ok ? run.value?.searchesRun : null).toBe(1);
    expect(run.ok ? run.value?.opportunitiesInserted : null).toBe(1);
  });

  it('returns the repository failure rather than swallowing it', async () => {
    const gateway = new StubOpportunityGateway(
      { literacy: [hit('1', 'A-1')] },
      { 1: opportunity('1', 'A-1') },
    );
    const repository = new InMemoryOpportunityRepository();
    const { useCase } = sweep(gateway, repository);
    repository.failNextQuery();

    const result = await useCase.execute({ keywords: ['literacy'], perKeyword: 10 });

    expect(result.ok).toBe(false);
  });
});
