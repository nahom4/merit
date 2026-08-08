import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { blockingKey, normalizeName, Organization } from '@merit/domain';
import { ReportFunderReachability } from '@merit/application';
import {
  LibsqlFunderRepository,
  LibsqlProspectRepository,
  ProPublicaFinancialsGateway,
  type Database,
} from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

/**
 * The whole slice below the UI, against real infrastructure: a real libSQL database and a real
 * HTTP server serving a real recorded ProPublica payload.
 *
 * The graph here is built row by row rather than ingested from the fixture bundle, because the
 * bundle cannot exercise the two behaviours this report exists for. It is a single year's
 * filings: no funder in it appears in two tax years, so turnover over time is undefined, and
 * exactly one of its entities has more than one funder, so there is no shared-funder path to
 * find. Those are properties of that bundle, not of the system, and a test that let them stand
 * would report green on an untested feature.
 *
 * The rows are shaped exactly as the ingest use case writes them, so the SQL under test is the
 * SQL that runs in production.
 */
let fresh: FreshDatabase;
let db: Database;
let server: Server;
let useCase: ReportFunderReachability;

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

const REPORTED_FUNDER = '111111111';
const INTERMEDIARY_FUNDER = '222222222';
const PEER = '900000001';
const SHARED_GRANTEE = '900000002';

/**
 * Registry entities. Revenue sits inside the peer band for a $656k organisation.
 *
 * The shared grantee is deliberately in a different program area, so it is *not* itself a peer.
 * A peer this funder gives to directly is first-degree evidence that the prospect list already
 * states; proximity is the second-degree claim, and the query excludes the former so the report
 * never dresses a fact the user has seen as a second, weaker one.
 */
const ENTITIES = [
  { ein: PEER, name: 'Coastal Literacy Partners', state: 'NC', ntee: 'B60', revenue: 600_000_00 },
  { ein: SHARED_GRANTEE, name: 'Wilmington Reads', state: 'NC', ntee: 'A50', revenue: 700_000_00 },
  { ein: '900000003', name: 'Brunswick Adult Learning', state: 'NC', ntee: 'B60', revenue: 500_000_00 },
  { ein: '900000004', name: 'Onslow Family Services', state: 'SC', ntee: 'P20', revenue: 650_000_00 },
];

/**
 * The reported funder gives across three years, dropping one grantee and adding another, so
 * turnover is a series rather than a single number. The intermediary funder gives to both the
 * peer and one of the reported funder's grantees, which is the shared-funder path.
 */
const GRANTS: readonly {
  funder: string;
  grantee: string;
  year: number;
  amount: number;
  object: string;
}[] = [
  { funder: REPORTED_FUNDER, grantee: SHARED_GRANTEE, year: 2021, amount: 8_000_00, object: 'obj-2021' },
  { funder: REPORTED_FUNDER, grantee: '900000003', year: 2021, amount: 12_000_00, object: 'obj-2021' },
  { funder: REPORTED_FUNDER, grantee: SHARED_GRANTEE, year: 2022, amount: 9_000_00, object: 'obj-2022' },
  { funder: REPORTED_FUNDER, grantee: '900000004', year: 2022, amount: 15_000_00, object: 'obj-2022' },
  { funder: REPORTED_FUNDER, grantee: SHARED_GRANTEE, year: 2023, amount: 10_000_00, object: 'obj-2023' },
  { funder: REPORTED_FUNDER, grantee: '900000003', year: 2023, amount: 11_000_00, object: 'obj-2023' },
  { funder: INTERMEDIARY_FUNDER, grantee: PEER, year: 2023, amount: 20_000_00, object: 'obj-i-2023' },
  {
    funder: INTERMEDIARY_FUNDER,
    grantee: SHARED_GRANTEE,
    year: 2023,
    amount: 5_000_00,
    object: 'obj-i-2023',
  },
];

const seed = async (database: Database): Promise<void> => {
  for (const [ein, name] of [
    [REPORTED_FUNDER, 'Coastal Community Foundation'],
    [INTERMEDIARY_FUNDER, 'Cape Fear Trust'],
  ]) {
    await database.execute({
      sql: `INSERT INTO funders (ein, name, state, source_forms, first_tax_year, last_tax_year)
            VALUES (?, ?, 'NC', '990PF', 2021, 2023)`,
      args: [ein!, name!],
    });
  }

  for (const entity of ENTITIES) {
    const normalized = normalizeName(entity.name);
    await database.execute({
      sql: `INSERT INTO entities (ein, canonical_name, normalized_name, ntee_code, city, state, zip,
                                  revenue_cents, blocking_key)
            VALUES (?, ?, ?, ?, 'Wilmington', ?, '28401', ?, ?)`,
      args: [
        entity.ein,
        entity.name,
        normalized,
        entity.ntee,
        entity.state,
        entity.revenue,
        blockingKey(normalized, entity.state),
      ],
    });
  }

  const nameOf = new Map(ENTITIES.map((entity) => [entity.ein, entity]));
  for (const [index, grant] of GRANTS.entries()) {
    const grantee = nameOf.get(grant.grantee)!;
    const id = `grant-${index}`;
    await database.execute({
      sql: `INSERT INTO grant_records (id, irs_object_id, funder_ein, tax_year, recipient_name,
                                       recipient_normalized, recipient_city, recipient_state,
                                       recipient_zip, purpose, amount_cents, source_form,
                                       stated_recipient_ein)
            VALUES (?, ?, ?, ?, ?, ?, 'Wilmington', ?, '28401', 'General operating support', ?, '990PF', ?)`,
      args: [
        id,
        grant.object,
        grant.funder,
        grant.year,
        grantee.name,
        normalizeName(grantee.name),
        grantee.state,
        grant.amount,
        grant.grantee,
      ],
    });
    await database.execute({
      sql: `INSERT INTO entity_links (grant_record_id, entity_ein, score_total, decision)
            VALUES (?, ?, 1.0, 'linked')`,
      args: [id, grant.grantee],
    });
  }
};

beforeAll(async () => {
  fresh = await freshDatabase();
  db = fresh.db;
  await seed(db);

  const payload = readFileSync(resolve('tests/fixtures/propublica/duke-endowment-560529965.json'), 'utf8');
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(payload);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind a port');

  useCase = new ReportFunderReachability(
    new LibsqlFunderRepository(db),
    new LibsqlProspectRepository(db),
    new ProPublicaFinancialsGateway({
      baseUrl: `http://127.0.0.1:${address.port}`,
      timeoutMs: 5_000,
      retries: 0,
    }),
  );
}, 120_000);

afterAll(async () => {
  await new Promise<void>((closed) => server.close(() => closed()));
  await fresh.destroy();
});

const report = async () =>
  unwrapOrThrow(await useCase.execute({ organization: ORGANIZATION, funderEin: REPORTED_FUNDER }));

describe('grantee list by year and turnover over time', () => {
  it('reports every filing year the funder appears in', async () => {
    const result = await report();
    expect(result.reachability.years.map((year) => year.taxYear)).toEqual([2021, 2022, 2023]);
  });

  it('computes turnover per year, not one number for the whole history', async () => {
    const result = await report();
    const [first, second, third] = result.reachability.years;

    expect(first?.turnover).toBeNull();
    // 2022 keeps the shared grantee and drops Brunswick: one of two departs.
    expect(second?.turnover).toBe(0.5);
    // 2023 keeps the shared grantee and drops Onslow, while Brunswick returns.
    expect(third?.turnover).toBe(0.5);
    expect(third?.newGranteeCount).toBe(1);
  });

  it('names the grantees behind each year so a row can be opened', async () => {
    const result = await report();
    const names = result.reachability.years[2]?.grantees.map((grantee) => grantee.name).sort();

    expect(names).toEqual(['Brunswick Adult Learning', 'Wilmington Reads']);
  });
});

describe('spread and mix', () => {
  it('reports the geographic spread across the states its grantees sit in', async () => {
    const result = await report();
    const states = result.reachability.geographicSpread.states.map((state) => state.state);

    expect(states).toContain('NC');
    expect(states).toContain('SC');
  });

  it('reports the program mix from the registry codes of its grantees', async () => {
    const result = await report();

    expect(result.reachability.programMix.map((mix) => mix.majorGroup)).toEqual(['A', 'B', 'P']);
    expect(result.reachability.programMix.find((mix) => mix.majorGroup === 'B')?.label).toBe('Education');
  });
});

describe('ask calibration', () => {
  it('recommends an ask drawn from first grants to organisations of a comparable size', async () => {
    const result = await report();

    expect(result.calibration.basis).toBe('first_grants_in_size_band');
    expect(result.calibration.recommendedCents).not.toBeNull();
  });
});

describe('affinity paths', () => {
  it('finds the grantee this funder shares with a funder of our peers', async () => {
    const result = await report();

    expect(result.affinity.paths).toHaveLength(1);
    expect(result.affinity.paths[0]?.granteeName).toBe('Wilmington Reads');
    expect(result.affinity.paths[0]?.via[0]?.funderName).toBe('Cape Fear Trust');
    expect(result.affinity.paths[0]?.via[0]?.peers[0]?.name).toBe('Coastal Literacy Partners');
  });

  it('carries the label and the denial with the data, not as a UI afterthought', async () => {
    const result = await report();

    expect(result.affinity.label).toBe('shared-funder proximity');
    expect(result.affinity.disclaimer).toContain('not a personal connection');
  });
});

describe('the financial trend', () => {
  it('reads the trend from the live-shaped ProPublica payload', async () => {
    const result = await report();

    expect(result.financials).not.toBeNull();
    expect(result.financials!.years.length).toBeGreaterThan(1);
    expect(result.financialsError).toBeNull();
  });

  it('states a payout rate against the funder’s assets', async () => {
    const result = await report();
    expect(result.financials!.payoutRate).not.toBeNull();
  });
});

describe('the brief', () => {
  it('cites a filing on every claim drawn from the filings', async () => {
    const result = await report();

    expect(result.brief.claims.length).toBeGreaterThan(0);
    for (const claim of result.brief.claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
    }
  });

  it('cites IRS object ids that are actually in the database', async () => {
    const result = await report();
    const cited = result.brief.claims
      .flatMap((claim) => claim.citations)
      .flatMap((citation) => (citation.kind === 'filings' ? citation.irsObjectIds : []));

    expect(cited.length).toBeGreaterThan(0);
    for (const objectId of new Set(cited)) {
      const found = await db.execute({
        sql: 'SELECT COUNT(*) AS n FROM grant_records WHERE irs_object_id = ?',
        args: [objectId],
      });
      expect(Number(found.rows[0]?.['n'])).toBeGreaterThan(0);
    }
  });

  it('states what the evidence does not support', async () => {
    const result = await report();
    expect(result.brief.limitations.join(' ')).toContain('does not tell you what it will do');
  });
});

describe('a funder that is not in the graph', () => {
  it('is reported as not found rather than as a funder with no giving', async () => {
    const result = await useCase.execute({ organization: ORGANIZATION, funderEin: '000000000' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('funder_not_found');
  });
});
