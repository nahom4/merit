import { describe, expect, it } from 'vitest';
import { isErr, isOk, unwrapOrThrow } from '@merit/shared';
import { Organization, type ReachabilityGrant, type SharedFunderRow } from '@merit/domain';
import { ReportFunderReachability } from './report-funder-reachability.use-case.js';
import { InMemoryFunderRepository } from '../../testing/in-memory-funder.repository.js';
import { InMemoryProspectRepository } from '../../testing/in-memory-prospect.repository.js';
import { StubFunderFinancialsGateway } from '../../testing/stub-funder-financials.gateway.js';
import type { PeerEntity } from '../../ports/prospect-repository.port.js';

const ORGANIZATION = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '561808737',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 656_000,
  }),
);

const FUNDER = {
  ein: '999999999',
  name: 'Coastal Community Foundation',
  state: 'NC',
  sourceForms: '990PF',
  firstTaxYear: 2021,
  lastTaxYear: 2023,
};

const grant = (overrides: Partial<ReachabilityGrant> = {}): ReachabilityGrant => ({
  granteeKey: 'a',
  granteeName: 'Grantee A',
  granteeState: 'NC',
  granteeNteeMajorGroup: 'B',
  granteeRevenueCents: 600_000_00,
  taxYear: 2022,
  amountCents: 10_000_00,
  irsObjectId: 'filing-1',
  purpose: null,
  ...overrides,
});

const HISTORY: readonly ReachabilityGrant[] = [
  grant({ granteeKey: 'a', taxYear: 2021, irsObjectId: 'filing-2021' }),
  grant({ granteeKey: 'a', taxYear: 2022, irsObjectId: 'filing-2022' }),
  grant({ granteeKey: 'b', granteeName: 'Grantee B', taxYear: 2022, irsObjectId: 'filing-2022' }),
  grant({ granteeKey: 'c', granteeName: 'Grantee C', taxYear: 2023, irsObjectId: 'filing-2023' }),
];

const PEERS: readonly PeerEntity[] = [
  { ein: '222222222', name: 'A Peer', state: 'NC', nteeCode: 'B60', revenueCents: 600_000_00 },
];

const PATH: SharedFunderRow = {
  granteeEin: '111111111',
  granteeName: 'Wilmington Reads',
  granteeState: 'NC',
  viaFunderEin: '888888888',
  viaFunderName: 'Another Trust',
  peerEin: '222222222',
  peerName: 'A Peer',
};

const useCase = ({
  funders = new InMemoryFunderRepository([{ profile: FUNDER, grants: HISTORY, sharedFunderPaths: [PATH] }]),
  prospects = new InMemoryProspectRepository(PEERS),
  financials = StubFunderFinancialsGateway.returning([
    {
      taxYear: 2021,
      formType: 'form_990_pf' as const,
      totalRevenueCents: 1_000_000_00,
      totalExpensesCents: 500_000_00,
      totalAssetsEndCents: 10_000_000_00,
      grantsPaidCents: 400_000_00,
    },
    {
      taxYear: 2023,
      formType: 'form_990_pf' as const,
      totalRevenueCents: 1_000_000_00,
      totalExpensesCents: 500_000_00,
      totalAssetsEndCents: 10_000_000_00,
      grantsPaidCents: 800_000_00,
    },
  ]),
} = {}) => new ReportFunderReachability(funders, prospects, financials);

describe('assembling the report', () => {
  it('reports the funder, its giving by year, and the ask calibrated for this organisation', async () => {
    const result = await useCase().execute({ organization: ORGANIZATION, funderEin: FUNDER.ein });

    expect(isOk(result)).toBe(true);
    const report = unwrapOrThrow(result);
    expect(report.funder.name).toBe('Coastal Community Foundation');
    expect(report.reachability.years.map((year) => year.taxYear)).toEqual([2021, 2022, 2023]);
    expect(report.calibration.recommendedCents).not.toBeNull();
  });

  it('builds affinity paths from the peers of this organisation, not of some other one', async () => {
    const result = await useCase().execute({ organization: ORGANIZATION, funderEin: FUNDER.ein });

    const report = unwrapOrThrow(result);
    expect(report.affinity.paths).toHaveLength(1);
    expect(report.affinity.paths[0]?.via[0]?.peers[0]?.name).toBe('A Peer');
  });

  it('states the materiality floor and how many peers the paths were drawn from', async () => {
    const result = await useCase().execute({ organization: ORGANIZATION, funderEin: FUNDER.ein });

    const report = unwrapOrThrow(result);
    expect(report.coverage.peersFound).toBe(1);
    // 0.5% of $656k, above the $2,500 minimum.
    expect(report.coverage.materialityFloorCents).toBe(3_280_00);
  });

  it('composes a brief in which every claim is cited', async () => {
    const result = await useCase().execute({ organization: ORGANIZATION, funderEin: FUNDER.ein });

    const report = unwrapOrThrow(result);
    expect(report.brief.claims.length).toBeGreaterThan(0);
    for (const claim of report.brief.claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
    }
    expect(report.brief.limitations.length).toBeGreaterThan(0);
  });
});

describe('when the funder is not on file', () => {
  it('returns a not-found result rather than an empty report', async () => {
    const result = await useCase({ funders: new InMemoryFunderRepository([]) }).execute({
      organization: ORGANIZATION,
      funderEin: '000000000',
    });

    expect(isErr(result)).toBe(true);
    expect(isErr(result) && result.error.code).toBe('funder_not_found');
  });
});

describe('when the database is unavailable', () => {
  it('surfaces the failure rather than reporting on a funder it could not read', async () => {
    const funders = new InMemoryFunderRepository([
      { profile: FUNDER, grants: HISTORY, sharedFunderPaths: [] },
    ]);
    funders.failNextHistoryQuery();

    const result = await useCase({ funders }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    expect(isErr(result)).toBe(true);
    expect(isErr(result) && result.error.code).toBe('repository_unavailable');
  });

  it('surfaces a failed peer query rather than silently reporting no affinity paths', async () => {
    const prospects = new InMemoryProspectRepository(PEERS);
    prospects.failNextPeerQuery();

    const result = await useCase({ prospects }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    expect(isErr(result)).toBe(true);
    expect(isErr(result) && result.error.code).toBe('repository_unavailable');
  });
});

describe('when ProPublica is unavailable', () => {
  it('still produces the report, because the filings are the primary source', async () => {
    const result = await useCase({ financials: StubFunderFinancialsGateway.failing() }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    expect(isOk(result)).toBe(true);
    expect(unwrapOrThrow(result).reachability.totalGrants).toBe(4);
  });

  it('says the trend is missing instead of rendering a blank where a trend should be', async () => {
    const result = await useCase({ financials: StubFunderFinancialsGateway.failing() }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    const report = unwrapOrThrow(result);
    expect(report.financials).toBeNull();
    expect(report.financialsError).not.toBeNull();
    expect(report.brief.limitations.join(' ')).toContain('ProPublica');
  });

  it('makes no financial claim it cannot cite', async () => {
    const result = await useCase({ financials: StubFunderFinancialsGateway.failing() }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    const report = unwrapOrThrow(result);
    expect(report.brief.claims.find((claim) => claim.topic === 'finances')).toBeUndefined();
  });
});

describe('when the funder has no grants on file', () => {
  it('reports the funder with an empty history rather than failing', async () => {
    const funders = new InMemoryFunderRepository([{ profile: FUNDER, grants: [], sharedFunderPaths: [] }]);

    const result = await useCase({ funders }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    const report = unwrapOrThrow(result);
    expect(report.reachability.totalGrants).toBe(0);
    expect(report.calibration.basis).toBe('no_evidence');
    expect(report.brief.claims.find((claim) => claim.topic === 'giving')).toBeUndefined();
  });
});

describe('when a query other than the history fails', () => {
  it('surfaces a failed shared-funder path query rather than reporting no proximity', async () => {
    // Reporting an empty path list here would claim there is no connection, when the truth
    // is that we could not look.
    const funders = new InMemoryFunderRepository([
      { profile: FUNDER, grants: HISTORY, sharedFunderPaths: [PATH] },
    ]);
    funders.failNextPathQuery();

    const result = await useCase({ funders }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    expect(isErr(result)).toBe(true);
    expect(isErr(result) && result.error.code).toBe('repository_unavailable');
  });
});

describe('when the funder lookup itself fails', () => {
  it('reports the database failure rather than a missing funder', async () => {
    // These are different facts and lead to different actions: one is a 404, the other is
    // "try again".
    const funders = new InMemoryFunderRepository([
      { profile: FUNDER, grants: HISTORY, sharedFunderPaths: [] },
    ]);
    funders.failNextFunderQuery();

    const result = await useCase({ funders }).execute({
      organization: ORGANIZATION,
      funderEin: FUNDER.ein,
    });

    expect(isErr(result)).toBe(true);
    expect(isErr(result) && result.error.code).toBe('repository_unavailable');
  });
});
