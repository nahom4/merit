import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibsqlProspectRepository, type Database } from '@merit/infrastructure';
import type { PeerEntity } from '@merit/application';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';
import { seedGivingGraph } from '../support/seed-graph.js';

/**
 * The prospect queries against a real giving graph.
 *
 * These are the queries the product's central claim runs on, and they are the ones the eval
 * tier cannot check cheaply -- an eval run needs the 3GB corpus. Pinning their behaviour here
 * is what makes it safe to change the SQL underneath them for speed.
 */
let fresh: FreshDatabase;
let db: Database;
let repository: LibsqlProspectRepository;

/** The seed spreads recipients across B60 and E32 at a flat $600k revenue. */
const PEER_QUERY = {
  nteeMajorGroup: 'B',
  minRevenueCents: 30_000_000,
  maxRevenueCents: 240_000_000,
  excludeEin: '000000000',
};

beforeAll(async () => {
  fresh = await freshDatabase();
  db = fresh.db;
  await seedGivingGraph(db);
  repository = new LibsqlProspectRepository(db);
}, 120_000);

afterAll(async () => {
  await fresh.destroy();
});

const peers = async (): Promise<readonly PeerEntity[]> => {
  const result = await repository.findPeers(PEER_QUERY);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('findPeers', () => {
  it('finds organisations in the requested program area', async () => {
    const found = await peers();
    expect(found.length).toBeGreaterThan(0);
    for (const peer of found) expect(peer.nteeCode?.startsWith('B')).toBe(true);
  });

  it('leaves out program areas that were not asked for', async () => {
    const found = await peers();
    expect(found.some((peer) => peer.nteeCode?.startsWith('E') === true)).toBe(false);
  });

  it('keeps every peer inside the revenue band', async () => {
    for (const peer of await peers()) {
      expect(peer.revenueCents).toBeGreaterThanOrEqual(PEER_QUERY.minRevenueCents);
      expect(peer.revenueCents).toBeLessThanOrEqual(PEER_QUERY.maxRevenueCents);
    }
  });

  it('returns nothing when the revenue band excludes every organisation', async () => {
    const result = await repository.findPeers({ ...PEER_QUERY, minRevenueCents: 900_000_000_000 });
    expect(result.ok && result.value).toHaveLength(0);
  });

  it('excludes the organisation asking the question', async () => {
    const found = await peers();
    const excluded = found[0]!.ein;
    const result = await repository.findPeers({ ...PEER_QUERY, excludeEin: excluded });
    expect(result.ok && result.value.some((peer) => peer.ein === excluded)).toBe(false);
  });

  it('offers only organisations somebody has actually funded', async () => {
    // An entity nobody has ever funded says nothing about who might fund us, so the peer set
    // is drawn from the graph rather than the registry.
    const found = await peers();
    for (const peer of found) {
      const linked = await db.execute({
        sql: "SELECT COUNT(*) AS n FROM entity_links WHERE entity_ein = ? AND decision = 'linked'",
        args: [peer.ein],
      });
      expect(Number(linked.rows[0]?.['n'])).toBeGreaterThan(0);
    }
  });
});

describe('findCandidateFunders', () => {
  it('returns the funders that gave to those peers, with their evidence', async () => {
    const peerEins = (await peers()).map((peer) => peer.ein);
    const result = await repository.findCandidateFunders(peerEins, ['NC'], 50);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.length).toBeGreaterThan(0);
    for (const candidate of result.value) {
      expect(candidate.peerGranteeCount).toBeGreaterThan(0);
      expect(candidate.peerGrantees.length).toBeGreaterThan(0);
    }
  });

  it('counts distinct peers rather than grants, so a repeat gift is not two grantees', async () => {
    const peerEins = (await peers()).map((peer) => peer.ein);
    const result = await repository.findCandidateFunders(peerEins, [], 50);
    if (!result.ok) throw new Error(result.error.message);

    for (const candidate of result.value) {
      expect(candidate.peerGranteeCount).toBeLessThanOrEqual(peerEins.length);
    }
  });

  it('counts a grantee as regional only when its state is in the region', async () => {
    const peerEins = (await peers()).map((peer) => peer.ein);
    const nowhere = await repository.findCandidateFunders(peerEins, [], 50);
    if (!nowhere.ok) throw new Error(nowhere.error.message);

    for (const candidate of nowhere.value) expect(candidate.regionalGranteeCount).toBe(0);
  });

  it('honours the candidate cap', async () => {
    const peerEins = (await peers()).map((peer) => peer.ein);
    const result = await repository.findCandidateFunders(peerEins, ['NC'], 3);
    expect(result.ok && result.value.length).toBeLessThanOrEqual(3);
  });

  it('asks nothing of the database when there are no peers', async () => {
    const result = await repository.findCandidateFunders([], ['NC'], 50);
    expect(result.ok && result.value).toHaveLength(0);
  });
});

describe('loadFunderHistories', () => {
  it('loads every grant a funder made, not only the ones to peers', async () => {
    const peerEins = (await peers()).map((peer) => peer.ein);
    const candidates = await repository.findCandidateFunders(peerEins, ['NC'], 5);
    if (!candidates.ok) throw new Error(candidates.error.message);

    const funderEins = candidates.value.map((candidate) => candidate.ein);
    const histories = await repository.loadFunderHistories(funderEins, 'B');
    if (!histories.ok) throw new Error(histories.error.message);

    for (const history of histories.value) {
      const total = await db.execute({
        sql: 'SELECT COUNT(*) AS n FROM grant_records WHERE funder_ein = ?',
        args: [history.funderEin],
      });
      expect(history.grants.length).toBe(Number(total.rows[0]?.['n']));
    }
  });

  it('keeps unresolved recipients, because they still carry a year and an amount', async () => {
    // Dropping them would make every funder look smaller and more open than it is.
    const withUnlinked = await db.execute(`
      SELECT g.funder_ein
      FROM grant_records g
      LEFT JOIN entity_links l ON l.grant_record_id = g.id
      WHERE l.decision IS NULL OR l.decision <> 'linked'
      LIMIT 1
    `);
    const funderEin = withUnlinked.rows[0]?.['funder_ein'];
    if (funderEin === undefined) return;

    const histories = await repository.loadFunderHistories([String(funderEin)], 'B');
    if (!histories.ok) throw new Error(histories.error.message);

    const counted = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM grant_records WHERE funder_ein = ?',
      args: [String(funderEin)],
    });
    expect(histories.value[0]?.grants.length).toBe(Number(counted.rows[0]?.['n']));
  });

  it('reports the share of a funder’s grantees in the requested program area', async () => {
    const peerEins = (await peers()).map((peer) => peer.ein);
    const candidates = await repository.findCandidateFunders(peerEins, ['NC'], 5);
    if (!candidates.ok) throw new Error(candidates.error.message);

    const histories = await repository.loadFunderHistories(
      candidates.value.map((candidate) => candidate.ein),
      'B',
    );
    if (!histories.ok) throw new Error(histories.error.message);

    for (const history of histories.value) {
      expect(history.sameProgramGranteeShare).toBeGreaterThanOrEqual(0);
      expect(history.sameProgramGranteeShare).toBeLessThanOrEqual(1);
    }
  });

  it('returns nothing for no funders', async () => {
    const result = await repository.loadFunderHistories([], 'B');
    expect(result.ok && result.value).toHaveLength(0);
  });
});
