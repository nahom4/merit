import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Organization, type GranteeGrant } from '@merit/domain';
import type { PeerEntity } from '../../ports/prospect-repository.port.js';
import { InMemoryProspectRepository, type FakeFunder } from '../../testing/in-memory-prospect.repository.js';
import { ScoreProspects } from './score-prospects.use-case.js';

/** The benchmark organisation, at the size the product is built for. */
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

const peer = (ein: string, overrides: Partial<PeerEntity> = {}): PeerEntity => ({
  ein,
  name: `Peer ${ein}`,
  state: 'NC',
  nteeCode: 'B60',
  revenueCents: 656_000_00,
  ...overrides,
});

/**
 * A funder with enough history for the signals to be computable: several grantees across
 * several years, turning over, at an amount well above the materiality floor.
 */
const funderGiving = (
  granteeEins: readonly string[],
  amountCents: number,
  years: readonly number[] = [2022, 2023, 2024],
): readonly GranteeGrant[] =>
  years.flatMap((taxYear, yearIndex) =>
    granteeEins.slice(yearIndex, yearIndex + 4).map((granteeKey) => ({
      granteeKey,
      taxYear,
      amountCents,
      granteeState: 'NC',
    })),
  );

const funder = (
  ein: string,
  grants: readonly GranteeGrant[],
  overrides: Partial<FakeFunder> = {},
): FakeFunder => ({
  ein,
  name: `Funder ${ein}`,
  state: 'NC',
  grants,
  ...overrides,
});

const PEERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

const listingFrom = async (
  peers: readonly PeerEntity[],
  funders: readonly FakeFunder[],
): ReturnType<ScoreProspects['execute']> =>
  new ScoreProspects(new InMemoryProspectRepository(peers, funders)).execute(organization);

describe('ScoreProspects', () => {
  it('surfaces a funder that gave to several peers at a material amount', async () => {
    const result = await listingFrom(
      PEERS.map((ein) => peer(ein)),
      [funder('f1', funderGiving(PEERS, 25_000_00))],
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.prospects).toHaveLength(1);
    expect(result.ok && result.value.prospects[0]?.funderEin).toBe('f1');
  });

  it('reports the four score components separately, never as one number', async () => {
    const result = await listingFrom(
      PEERS.map((ein) => peer(ein)),
      [funder('f1', funderGiving(PEERS, 25_000_00))],
    );
    if (!result.ok) throw new Error('expected a listing');

    const score = result.value.prospects[0]!.score;
    expect(score).toHaveProperty('openness');
    expect(score).toHaveProperty('affinity');
    expect(score).toHaveProperty('geographyFit');
    expect(score).toHaveProperty('sizeFit');
  });

  it('carries the grantee rows behind every prospect', async () => {
    const result = await listingFrom(
      PEERS.map((ein) => peer(ein)),
      [funder('f1', funderGiving(PEERS, 25_000_00))],
    );
    if (!result.ok) throw new Error('expected a listing');

    expect(result.value.prospects[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('drops a funder whose typical grant is below the materiality floor', async () => {
    // 0.5% of $656k is $3,280. A funder writing $500 cheques is not worth an application.
    const result = await listingFrom(
      PEERS.map((ein) => peer(ein)),
      [funder('f1', funderGiving(PEERS, 500_00))],
    );

    expect(result.ok && result.value.prospects).toHaveLength(0);
    expect(result.ok && result.value.coverage.credibleFunders).toBe(0);
  });

  it('drops a funder operating far above this organisation’s scale', async () => {
    const result = await listingFrom(
      PEERS.map((ein) => peer(ein)),
      [funder('f1', funderGiving(PEERS, 2_000_000_00))],
    );

    expect(result.ok && result.value.prospects).toHaveLength(0);
  });

  it('drops a funder with too little in common to be credible', async () => {
    // One peer grantee and none of them in region: the bar is two peers, or one nearby.
    const result = await listingFrom(
      PEERS.map((ein) => peer(ein, { state: 'CA' })),
      [funder('f1', [{ granteeKey: 'p1', taxYear: 2024, amountCents: 25_000_00, granteeState: 'CA' }])],
    );
    if (!result.ok) throw new Error('expected a listing');

    expect(result.value.prospects).toHaveLength(0);
    expect(result.value.coverage.candidateFundersConsidered).toBe(1);
  });

  it('leads with regional funders rather than burying them under national ones', async () => {
    const outOfRegion = PEERS.map((ein) => peer(ein, { state: 'CA' }));
    const inRegion = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((ein) => peer(ein, { state: 'NC' }));

    const result = await listingFrom(
      [...outOfRegion, ...inRegion],
      [
        funder('national', funderGiving(PEERS, 25_000_00)),
        funder('regional', funderGiving(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], 25_000_00)),
      ],
    );
    if (!result.ok) throw new Error('expected a listing');

    const regionalIndex = result.value.prospects.findIndex((p) => p.funderEin === 'regional');
    const nationalIndex = result.value.prospects.findIndex((p) => p.funderEin === 'national');
    expect(regionalIndex).toBeGreaterThanOrEqual(0);
    if (nationalIndex >= 0) expect(regionalIndex).toBeLessThan(nationalIndex);
  });

  it('states coverage rather than implying completeness', async () => {
    const result = await listingFrom(
      PEERS.map((ein) => peer(ein)),
      [funder('f1', funderGiving(PEERS, 25_000_00)), funder('f2', funderGiving(PEERS, 100_00))],
    );
    if (!result.ok) throw new Error('expected a listing');

    expect(result.value.coverage.peersFound).toBe(PEERS.length);
    expect(result.value.coverage.candidateFundersConsidered).toBe(2);
    expect(result.value.coverage.credibleFunders).toBe(1);
    expect(result.value.coverage.materialityFloorCents).toBe(3_280_00);
  });

  it('reports an empty listing with its coverage when nobody funds this program area', async () => {
    const result = await listingFrom([peer('p1', { nteeCode: 'E32' })], []);
    if (!result.ok) throw new Error('expected a listing');

    expect(result.value.prospects).toHaveLength(0);
    expect(result.value.coverage.peersFound).toBe(0);
  });

  it('excludes organisations outside the comparable revenue band from the peer set', async () => {
    const result = await listingFrom(
      [peer('tiny', { revenueCents: 10_000_00 }), peer('huge', { revenueCents: 40_000_000_00 })],
      [],
    );

    expect(result.ok && result.value.coverage.peersFound).toBe(0);
  });

  it('never counts the organisation itself as its own peer', async () => {
    const result = await listingFrom([peer('581613254'), peer('p1')], []);
    if (!result.ok) throw new Error('expected a listing');

    expect(result.value.coverage.peersFound).toBe(1);
  });

  it('surfaces a failed peer query as a value rather than throwing', async () => {
    const repository = new InMemoryProspectRepository([peer('p1')], []);
    repository.failNextPeerQuery();

    const result = await new ScoreProspects(repository).execute(organization);
    expect(result.ok).toBe(false);
  });

  it('surfaces a failed candidate query as a value rather than throwing', async () => {
    const repository = new InMemoryProspectRepository(
      PEERS.map((ein) => peer(ein)),
      [funder('f1', funderGiving(PEERS, 25_000_00))],
    );
    repository.failNextCandidateQuery();

    const result = await new ScoreProspects(repository).execute(organization);
    expect(result.ok).toBe(false);
  });
});
