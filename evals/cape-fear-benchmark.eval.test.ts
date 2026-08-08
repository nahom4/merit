import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Organization } from '@merit/domain';
import { LibsqlProspectRepository, type Database } from '@merit/infrastructure';
import { ScoreProspects, type ProspectListing } from '@merit/application';
import { openCorpus, recordEvalRun, thresholds } from './support/corpus.js';

/**
 * S1's acceptance criterion, executable.
 *
 * Cape Fear Literacy Council is a real $656k adult-literacy organisation in Wilmington NC.
 * The bar -- at least 15 credible funders -- was set before any data was ingested, and was
 * cleared on 17% of one year during validation (validation/RESULTS.txt). Credible means two
 * or more comparable grantees or one in region, with a median grant above the materiality
 * floor.
 */
const CAPE_FEAR = unwrapOrThrow(
  Organization.parse({
    id: 'eval_cape_fear',
    name: 'Cape Fear Literacy Council',
    ein: '581613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 655_738,
  }),
);

let db: Database;
let listing: ProspectListing;

beforeAll(async () => {
  db = openCorpus();
  const result = await new ScoreProspects(new LibsqlProspectRepository(db)).execute(CAPE_FEAR);
  if (!result.ok) throw new Error(result.error.message);
  listing = result.value;

  console.log(
    `Cape Fear Literacy Council: ${listing.coverage.peersFound} peers, ` +
      `${listing.coverage.candidateFundersConsidered} candidate funders, ` +
      `${listing.coverage.credibleFunders} credible and material, ` +
      `${listing.prospects.filter((p) => p.regionalGranteeCount > 0).length} of them regional`,
  );
  for (const prospect of listing.prospects.slice(0, 12)) {
    console.log(
      `  [${prospect.regionalGranteeCount > 0 ? 'REGION' : '  nat '}] ` +
        `${prospect.funderName.slice(0, 44).padEnd(44)} | ${String(prospect.peerGranteeCount).padStart(2)} peers ` +
        `| median $${Math.round((prospect.signals.askP50 ?? 0) / 100)
          .toLocaleString('en-US')
          .padStart(9)}`,
    );
  }
});

afterAll(async () => {
  await recordEvalRun(db, 'cape_fear_credible_funders', listing.coverage.credibleFunders, 'irs_2025_corpus');
  db.close();
});

describe('Cape Fear coverage benchmark', () => {
  it('surfaces at least fifteen credible, material funders', () => {
    expect(listing.coverage.credibleFunders).toBeGreaterThanOrEqual(
      thresholds.coverage_benchmark.cape_fear_credible_funders_floor,
    );
  });

  it('finds a peer set to draw those funders from', () => {
    expect(listing.coverage.peersFound).toBeGreaterThan(0);
  });

  it('surfaces regional funders, which is the point of the whole approach', () => {
    // These are the foundations that post nothing, anywhere, and would never appear in a
    // federal opportunity sweep.
    const regional = listing.prospects.filter((prospect) => prospect.regionalGranteeCount > 0);
    expect(regional.length).toBeGreaterThan(0);
  });

  it('leads with regional funders rather than burying them under national ones', () => {
    const firstNationalIndex = listing.prospects.findIndex((p) => p.regionalGranteeCount === 0);
    const lastRegionalIndex = listing.prospects.reduce(
      (last, prospect, index) => (prospect.regionalGranteeCount > 0 ? index : last),
      -1,
    );
    if (firstNationalIndex === -1 || lastRegionalIndex === -1) return;
    expect(lastRegionalIndex).toBeLessThan(firstNationalIndex);
  });

  it('excludes funders whose median grant is below the materiality floor', () => {
    const floor = listing.coverage.materialityFloorCents;
    const tooSmall = listing.prospects.filter(
      (prospect) => prospect.signals.askP50 !== null && prospect.signals.askP50 < floor,
    );
    expect(tooSmall).toHaveLength(0);
  });

  it('shows four separate score components for every prospect, never one number', () => {
    for (const prospect of listing.prospects) {
      expect(prospect.score).toHaveProperty('openness');
      expect(prospect.score).toHaveProperty('affinity');
      expect(prospect.score).toHaveProperty('geographyFit');
      expect(prospect.score).toHaveProperty('sizeFit');
    }
  });

  it('carries inspectable grantee evidence behind every prospect', () => {
    for (const prospect of listing.prospects) {
      expect(prospect.evidence.length).toBeGreaterThan(0);
    }
  });
});
