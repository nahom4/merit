import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screenEligibility, type FederalOpportunity } from '@merit/domain';
import type { StoredAssessment } from '@merit/application';
import { LibsqlOpportunityRepository, LibsqlRegistryStatusReader } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

/**
 * Real libSQL, real migrations, no in-memory substitute for SQL (ADR 0002). What is being
 * proved here is that the SQL is correct: idempotent upserts, the JSON columns surviving a
 * round trip, and the screening decision coming back out as the value that went in.
 */
let database: FreshDatabase;

const opportunity = (overrides: Partial<FederalOpportunity> = {}): FederalOpportunity => ({
  id: '362839',
  number: 'HHS-2026-ACF-OCS-EAH-0027',
  title: 'Affordable Housing and Supportive Services Demonstration',
  agency: 'Administration for Children and Families - OCS',
  status: 'posted',
  openDate: '2026-07-24',
  closeDate: '2026-08-24',
  programNumbers: ['93.647'],
  programTitles: ['Social Services Research and Demonstration'],
  applicantTypeCodes: ['07', '11', '12'],
  eligibilityText: 'Applications from individuals and foreign entities are not eligible.',
  summary: 'Support services for residents of affordable housing.',
  fundingCategories: ['Income Security and Social Services'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachments: [{ id: '344872', fileName: 'nofo.pdf', mimeType: 'application/pdf' }],
  ...overrides,
});

const repository = () => new LibsqlOpportunityRepository(database.db);

beforeAll(async () => {
  database = await freshDatabase();
});

afterAll(async () => {
  await database.destroy();
});

describe('LibsqlOpportunityRepository', () => {
  it('round-trips every field an announcement carries', async () => {
    const written = await repository().upsertOpportunities([opportunity({ id: 'round-trip' })]);
    expect(written.ok).toBe(true);

    const listed = await repository().listOpportunities(50);
    const stored = listed.ok ? listed.value.find((row) => row.id === 'round-trip') : undefined;

    expect(stored).toEqual(opportunity({ id: 'round-trip' }));
  });

  it('is idempotent: the same announcement swept twice is one row', async () => {
    await repository().upsertOpportunities([opportunity({ id: 'idempotent' })]);
    const second = await repository().upsertOpportunities([
      opportunity({ id: 'idempotent', title: 'A revised title' }),
    ]);

    expect(second.ok ? second.value.inserted : -1).toBe(0);
    expect(second.ok ? second.value.updated : -1).toBe(1);

    const listed = await repository().listOpportunities(50);
    const matching = listed.ok ? listed.value.filter((row) => row.id === 'idempotent') : [];
    expect(matching.length).toBe(1);
    expect(matching[0]?.title).toBe('A revised title');
  });

  it('rewrites program numbers rather than accumulating stale ones', async () => {
    await repository().upsertOpportunities([
      opportunity({ id: 'programs', programNumbers: ['93.647', '93.600'], programTitles: ['A', 'B'] }),
    ]);
    await repository().upsertOpportunities([
      opportunity({ id: 'programs', programNumbers: ['93.647'], programTitles: ['A'] }),
    ]);

    const listed = await repository().listOpportunities(50);
    const stored = listed.ok ? listed.value.find((row) => row.id === 'programs') : undefined;

    expect(stored?.programNumbers).toEqual(['93.647']);
  });

  it('stores a screening decision with every readable reason and reads it back whole', async () => {
    await repository().upsertOpportunities([opportunity({ id: 'screened', applicantTypeCodes: ['00'] })]);

    const screening = screenEligibility({
      opportunity: opportunity({ id: 'screened', applicantTypeCodes: ['00'] }),
      organizationName: 'Cape Fear Literacy Council',
      organizationState: 'NC',
      charityStatus: 'confirmed',
    });

    const assessment: StoredAssessment = {
      organizationId: 'org_1',
      opportunityId: 'screened',
      screening,
      fit: null,
      fitState: 'not_applicable',
      fitStateReason: null,
      assessedAt: '2026-08-08T09:00:00.000Z',
    };

    await repository().saveAssessments([assessment]);
    const board = await repository().loadBoard('org_1', 50);
    const stored = board.ok ? board.value.find((row) => row.opportunity.id === 'screened') : undefined;

    expect(stored?.assessment?.screening.outcome).toBe('ineligible');
    expect(stored?.assessment?.screening.rejections[0]?.reason).toContain('State governments');
    expect(stored?.assessment?.screening.checks.length).toBe(4);
  });

  it('round-trips a fit score with its matched areas and gaps', async () => {
    await repository().upsertOpportunities([opportunity({ id: 'scored' })]);

    await repository().saveAssessments([
      {
        organizationId: 'org_1',
        opportunityId: 'scored',
        screening: screenEligibility({
          opportunity: opportunity({ id: 'scored' }),
          organizationName: 'Cape Fear Literacy Council',
          organizationState: 'NC',
          charityStatus: 'confirmed',
        }),
        fit: {
          fitScore: 74,
          rationale: 'The announcement funds supportive services.',
          matchedProgramAreas: ['Income Security and Social Services'],
          gaps: ['No affordable housing partner is named.'],
        },
        fitState: 'scored',
        fitStateReason: null,
        assessedAt: '2026-08-08T09:00:00.000Z',
      },
    ]);

    const board = await repository().loadBoard('org_1', 50);
    const stored = board.ok ? board.value.find((row) => row.opportunity.id === 'scored') : undefined;

    expect(stored?.assessment?.fit?.fitScore).toBe(74);
    expect(stored?.assessment?.fit?.matchedProgramAreas).toEqual(['Income Security and Social Services']);
    expect(stored?.assessment?.fit?.gaps).toEqual(['No affordable housing partner is named.']);
  });

  it('keeps one organisation’s assessment out of another’s board', async () => {
    await repository().upsertOpportunities([opportunity({ id: 'per-org' })]);
    await repository().saveAssessments([
      {
        organizationId: 'org_a',
        opportunityId: 'per-org',
        screening: screenEligibility({
          opportunity: opportunity({ id: 'per-org' }),
          organizationName: 'A',
          organizationState: 'NC',
          charityStatus: 'confirmed',
        }),
        fit: null,
        fitState: 'queued',
        fitStateReason: 'Not scored yet.',
        assessedAt: '2026-08-08T09:00:00.000Z',
      },
    ]);

    const other = await repository().loadBoard('org_b', 50);
    const row = other.ok ? other.value.find((entry) => entry.opportunity.id === 'per-org') : undefined;

    expect(row?.assessment).toBeNull();
  });

  it('records a sweep and returns the most recent one', async () => {
    await repository().recordSweep({
      id: 'sweep_old',
      startedAt: '2026-08-07T06:00:00.000Z',
      finishedAt: '2026-08-07T06:03:00.000Z',
      searchesRun: 3,
      hitsSeen: 12,
      opportunitiesInserted: 12,
      opportunitiesUpdated: 0,
      parseFaults: 0,
    });
    await repository().recordSweep({
      id: 'sweep_new',
      startedAt: '2026-08-08T06:00:00.000Z',
      finishedAt: '2026-08-08T06:04:00.000Z',
      searchesRun: 3,
      hitsSeen: 42,
      opportunitiesInserted: 2,
      opportunitiesUpdated: 40,
      parseFaults: 1,
    });

    const latest = await repository().latestSweep();

    expect(latest.ok ? latest.value?.id : null).toBe('sweep_new');
    expect(latest.ok ? latest.value?.hitsSeen : null).toBe(42);
  });
});

describe('LibsqlRegistryStatusReader', () => {
  it('reads 501(c)(3) status from the registry row', async () => {
    await database.db.execute({
      sql: `INSERT INTO entities (ein, canonical_name, normalized_name, subsection)
            VALUES (?, ?, ?, ?)`,
      args: ['581613254', 'CAPE FEAR LITERACY COUNCIL', 'cape fear literacy council', 3],
    });

    const status = await new LibsqlRegistryStatusReader(database.db).findStatus('581613254');

    expect(status.ok ? status.value.isInRegistry : false).toBe(true);
    expect(status.ok ? status.value.subsectionCode : null).toBe(3);
  });

  it('reports an EIN absent from the registry as absent, not as ineligible', async () => {
    const status = await new LibsqlRegistryStatusReader(database.db).findStatus('999999999');

    expect(status.ok ? status.value.isInRegistry : true).toBe(false);
    expect(status.ok ? status.value.subsectionCode : 0).toBeNull();
  });
});
