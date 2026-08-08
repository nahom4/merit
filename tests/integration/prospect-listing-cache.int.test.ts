import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibsqlProspectListingCache } from '@merit/infrastructure';
import type { CachedListingPayload } from '@merit/application';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

/**
 * The cache that keeps the prospect screen from re-reading 290,000 grant rows on every load.
 *
 * What matters here is that a cached listing comes back identical, and that a payload this
 * version cannot read is a miss rather than a crash — the alternative is a screen that dies
 * because an older build wrote a different shape.
 */

let database: FreshDatabase;

const PAYLOAD: CachedListingPayload = {
  prospects: [
    {
      funderEin: '561234567',
      funderName: 'Smith Foundation',
      funderState: 'NC',
      score: {
        openness: 0.4,
        affinity: 0.8,
        geographyFit: 1,
        sizeFit: 0.6,
        total: 71.2,
        isCredible: true,
        credibilityReason: 'credible',
      },
      signals: {
        turnover: 0.3,
        newGranteesPerYear: 4,
        newGranteeShare: 0.25,
        concentration: 0.12,
        askP50: 25_000_00,
        askP90: 100_000_00,
        firstTimeAskP50: 10_000_00,
        retentionYearsP50: 2,
        stateShares: { NC: 0.8, SC: 0.2 },
        distinctGrantees: 40,
        totalGrants: 96,
        yearsCovered: [2022, 2023, 2024],
      },
      peerGranteeCount: 3,
      regionalGranteeCount: 2,
      evidence: [
        {
          entityEin: '561111111',
          name: 'Coastal Literacy',
          city: 'Wilmington',
          state: 'NC',
          taxYear: 2023,
          amountCents: 15_000_00,
          purpose: 'Adult literacy programming',
        },
      ],
    },
  ],
  coverage: {
    peersFound: 12,
    candidateFundersConsidered: 400,
    credibleFunders: 1,
    materialityFloorCents: 271_077,
  },
};

beforeAll(async () => {
  database = await freshDatabase();
});

afterAll(async () => {
  await database.destroy();
});

describe('LibsqlProspectListingCache', () => {
  it('returns a miss before anything is cached', async () => {
    const cache = new LibsqlProspectListingCache(database.db);
    const read = await cache.readCached('org_missing');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toBeNull();
  });

  it('round-trips a listing, scores and evidence intact', async () => {
    const cache = new LibsqlProspectListingCache(database.db);
    const written = await cache.writeCached('org_1', PAYLOAD);
    expect(written.ok).toBe(true);

    const read = await cache.readCached('org_1');
    if (!read.ok || read.value === null) throw new Error('the cached listing went missing');
    expect(read.value.payload).toEqual(PAYLOAD);
    expect(read.value.computedAt).not.toBe('');
  });

  it('overwrites rather than accumulating, so re-scoring replaces the answer', async () => {
    const cache = new LibsqlProspectListingCache(database.db);
    await cache.writeCached('org_1', PAYLOAD);
    await cache.writeCached('org_1', {
      ...PAYLOAD,
      coverage: { ...PAYLOAD.coverage, credibleFunders: 99 },
    });

    const read = await cache.readCached('org_1');
    if (!read.ok || read.value === null) throw new Error('the cached listing went missing');
    expect(read.value.payload.coverage.credibleFunders).toBe(99);
  });

  it('treats a payload it cannot parse as a miss rather than failing the screen', async () => {
    await database.db.execute({
      sql: `INSERT INTO prospect_listings (organization_id, payload, computed_at)
            VALUES (?, ?, ?)
            ON CONFLICT (organization_id) DO UPDATE SET payload = excluded.payload`,
      args: ['org_stale', '{"prospects":[{"funderEin":1}]}', new Date().toISOString()],
    });

    const read = await new LibsqlProspectListingCache(database.db).readCached('org_stale');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toBeNull();
  });
});
