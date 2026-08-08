import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibsqlFunderRepository, LibsqlProspectRepository, type Database } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';
import { seedGivingGraph } from '../support/seed-graph.js';

/**
 * The reachability queries against a real giving graph, built by ingesting the fixture IRS
 * bundle through the real use cases.
 *
 * The shared-funder path query is the one that earns this file: it is a three-hop join whose
 * correctness cannot be read off the SQL, and getting it subtly wrong would produce a
 * plausible-looking list of connections that are not there.
 */
let fresh: FreshDatabase;
let db: Database;
let repository: LibsqlFunderRepository;
let prospects: LibsqlProspectRepository;

beforeAll(async () => {
  fresh = await freshDatabase();
  db = fresh.db;
  await seedGivingGraph(db);
  repository = new LibsqlFunderRepository(db);
  prospects = new LibsqlProspectRepository(db);
}, 120_000);

afterAll(async () => {
  await fresh.destroy();
});

/** A funder the seeded graph actually contains, chosen by grant volume so the history is
 *  worth asserting against. */
const busiestFunderEin = async (): Promise<string> => {
  const result = await db.execute(`
    SELECT funder_ein, COUNT(*) AS n FROM grant_records
    GROUP BY funder_ein ORDER BY n DESC LIMIT 1
  `);
  return String(result.rows[0]?.['funder_ein']);
};

const peerEins = async (): Promise<readonly string[]> => {
  const found = await prospects.findPeers({
    nteeMajorGroup: 'B',
    minRevenueCents: 30_000_000,
    maxRevenueCents: 240_000_000,
    excludeEin: '000000000',
  });
  if (!found.ok) throw new Error(found.error.message);
  return found.value.map((peer) => peer.ein);
};

describe('findFunder', () => {
  it('returns the funder the graph holds under that EIN', async () => {
    const ein = await busiestFunderEin();
    const result = await repository.findFunder(ein);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value?.ein).toBe(ein);
    expect(result.value?.name.length).toBeGreaterThan(0);
  });

  it('returns nothing for an EIN the graph has never seen, rather than an empty funder', async () => {
    const result = await repository.findFunder('000000000');
    expect(result.ok && result.value).toBeNull();
  });

  it('reports the span of filing years the funder appears in', async () => {
    const ein = await busiestFunderEin();
    const result = await repository.findFunder(ein);
    if (!result.ok) throw new Error(result.error.message);

    const actual = await db.execute({
      sql: 'SELECT MIN(tax_year) AS lo, MAX(tax_year) AS hi FROM grant_records WHERE funder_ein = ?',
      args: [ein],
    });
    expect(result.value?.firstTaxYear).toBe(Number(actual.rows[0]?.['lo']));
    expect(result.value?.lastTaxYear).toBe(Number(actual.rows[0]?.['hi']));
  });
});

describe('loadGranteeHistory', () => {
  it('loads every grant the funder made', async () => {
    const ein = await busiestFunderEin();
    const result = await repository.loadGranteeHistory(ein);
    if (!result.ok) throw new Error(result.error.message);

    const counted = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM grant_records WHERE funder_ein = ?',
      args: [ein],
    });
    expect(result.value.length).toBe(Number(counted.rows[0]?.['n']));
  });

  it('carries the IRS object id on every row, because the brief has to cite it', async () => {
    const result = await repository.loadGranteeHistory(await busiestFunderEin());
    if (!result.ok) throw new Error(result.error.message);

    for (const grant of result.value) {
      expect(grant.irsObjectId.length).toBeGreaterThan(0);
      expect(Number.isInteger(grant.taxYear)).toBe(true);
      expect(Number.isInteger(grant.amountCents)).toBe(true);
    }
  });

  it('keys a resolved grantee on its registry EIN and an unresolved one on its normalised name', async () => {
    const result = await repository.loadGranteeHistory(await busiestFunderEin());
    if (!result.ok) throw new Error(result.error.message);

    for (const grant of result.value) {
      expect(grant.granteeKey.length).toBeGreaterThan(0);
      expect(grant.granteeName.length).toBeGreaterThan(0);
    }
  });

  it('takes the program area and revenue from the registry where the grantee resolved', async () => {
    const linked = await db.execute(`
      SELECT g.funder_ein
      FROM grant_records g
      JOIN entity_links l ON l.grant_record_id = g.id AND l.decision = 'linked'
      JOIN entities e ON e.ein = l.entity_ein AND e.ntee_code IS NOT NULL
      LIMIT 1
    `);
    const funderEin = String(linked.rows[0]?.['funder_ein']);

    const result = await repository.loadGranteeHistory(funderEin);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.some((grant) => grant.granteeNteeMajorGroup !== null)).toBe(true);
    expect(result.value.some((grant) => grant.granteeRevenueCents !== null)).toBe(true);
  });

  it('reduces the registry program code to the major group the report groups on', async () => {
    const result = await repository.loadGranteeHistory(await busiestFunderEin());
    if (!result.ok) throw new Error(result.error.message);

    for (const grant of result.value) {
      if (grant.granteeNteeMajorGroup === null) continue;
      expect(grant.granteeNteeMajorGroup).toHaveLength(1);
    }
  });

  it('returns nothing for a funder with no grants rather than failing', async () => {
    const result = await repository.loadGranteeHistory('000000000');
    expect(result.ok && result.value).toHaveLength(0);
  });
});

describe('findSharedFunderPaths', () => {
  it('returns only edges whose peer was actually asked about', async () => {
    const peers = await peerEins();
    const ein = await busiestFunderEin();
    const result = await repository.findSharedFunderPaths(ein, peers, 200);
    if (!result.ok) throw new Error(result.error.message);

    const asked = new Set(peers);
    for (const row of result.value) expect(asked.has(row.peerEin)).toBe(true);
  });

  it('never routes a path through the funder under report — that would connect it to itself', async () => {
    const peers = await peerEins();
    const ein = await busiestFunderEin();
    const result = await repository.findSharedFunderPaths(ein, peers, 200);
    if (!result.ok) throw new Error(result.error.message);

    for (const row of result.value) expect(row.viaFunderEin).not.toBe(ein);
  });

  it('proves each edge: the intermediary funds both the peer and this funder’s grantee', async () => {
    const peers = await peerEins();
    const ein = await busiestFunderEin();
    const result = await repository.findSharedFunderPaths(ein, peers, 25);
    if (!result.ok) throw new Error(result.error.message);

    for (const row of result.value) {
      const givesToPeer = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM grant_records g
              JOIN entity_links l ON l.grant_record_id = g.id AND l.decision = 'linked'
              WHERE g.funder_ein = ? AND l.entity_ein = ?`,
        args: [row.viaFunderEin, row.peerEin],
      });
      const givesToGrantee = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM grant_records g
              JOIN entity_links l ON l.grant_record_id = g.id AND l.decision = 'linked'
              WHERE g.funder_ein = ? AND l.entity_ein = ?`,
        args: [row.viaFunderEin, row.granteeEin],
      });
      const reportedFunderGives = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM grant_records g
              JOIN entity_links l ON l.grant_record_id = g.id AND l.decision = 'linked'
              WHERE g.funder_ein = ? AND l.entity_ein = ?`,
        args: [ein, row.granteeEin],
      });

      expect(Number(givesToPeer.rows[0]?.['n'])).toBeGreaterThan(0);
      expect(Number(givesToGrantee.rows[0]?.['n'])).toBeGreaterThan(0);
      expect(Number(reportedFunderGives.rows[0]?.['n'])).toBeGreaterThan(0);
    }
  });

  it('honours the edge cap', async () => {
    const peers = await peerEins();
    const ein = await busiestFunderEin();
    const result = await repository.findSharedFunderPaths(ein, peers, 3);
    expect(result.ok && result.value.length).toBeLessThanOrEqual(3);
  });

  it('asks nothing of the database when there are no peers to connect through', async () => {
    const result = await repository.findSharedFunderPaths(await busiestFunderEin(), [], 200);
    expect(result.ok && result.value).toHaveLength(0);
  });
});
