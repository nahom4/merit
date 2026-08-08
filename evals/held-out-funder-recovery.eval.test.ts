import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '@merit/domain';
import { LibsqlProspectRepository, type Database } from '@merit/infrastructure';
import { ScoreProspects } from '@merit/application';
import { openCorpus, recordEvalRun, thresholds, yieldToEventLoop } from './support/corpus.js';

/**
 * Held-out funder recovery: the measurement that matters most.
 *
 * The product's central claim is "these are foundations that would fund you". For an
 * organisation already in the graph we know who actually funded it. Hide those funders,
 * ask the recommender for prospects, and count how many of the real ones it surfaces.
 *
 * This makes the claim testable against real outcomes on data already in hand, without
 * waiting for a user to apply and hear back.
 */
const ORGANISATIONS_TESTED = 12;
const TOP_N = 50;

let db: Database;

beforeAll(() => {
  db = openCorpus();
});

afterAll(() => {
  db.close();
});

interface HeldOut {
  readonly ein: string;
  readonly name: string;
  readonly state: string;
  readonly nteeCode: string;
  readonly revenueCents: number;
  readonly trueFunders: ReadonlySet<string>;
}

/** Organisations with enough funders on file for recovery to mean anything. */
const heldOutOrganisations = async (): Promise<readonly HeldOut[]> => {
  const result = await db.execute({
    sql: `SELECT e.ein, e.canonical_name, e.state, e.ntee_code, e.revenue_cents,
                 COUNT(DISTINCT g.funder_ein) AS funder_count
          FROM entities e
          JOIN entity_links l ON l.entity_ein = e.ein AND l.decision = 'linked'
          JOIN grant_records g ON g.id = l.grant_record_id
          WHERE e.revenue_cents BETWEEN 20000000 AND 500000000
            AND e.ntee_code IS NOT NULL
            AND e.state IS NOT NULL
          GROUP BY e.ein
          HAVING funder_count >= 3
          ORDER BY e.ein
          LIMIT ?`,
    args: [ORGANISATIONS_TESTED],
  });

  const organisations: HeldOut[] = [];
  for (const row of result.rows) {
    const ein = String(row['ein']);
    const funders = await db.execute({
      sql: `SELECT DISTINCT g.funder_ein
            FROM entity_links l JOIN grant_records g ON g.id = l.grant_record_id
            WHERE l.entity_ein = ? AND l.decision = 'linked'`,
      args: [ein],
    });
    organisations.push({
      ein,
      name: String(row['canonical_name']),
      state: String(row['state']),
      nteeCode: String(row['ntee_code']),
      revenueCents: Number(row['revenue_cents']),
      trueFunders: new Set(funders.rows.map((funder) => String(funder['funder_ein']))),
    });
  }
  return organisations;
};

describe('held-out funder recovery', () => {
  it('surfaces organisations’ real funders above the committed floor', async () => {
    const organisations = await heldOutOrganisations();
    expect(organisations.length).toBeGreaterThan(0);

    const scorer = new ScoreProspects(new LibsqlProspectRepository(db));
    const recalls: number[] = [];
    const unmeasurable: string[] = [];

    for (const held of organisations) {
      await yieldToEventLoop();
      const parsed = Organization.parse({
        id: `eval_${held.ein}`,
        name: held.name,
        ein: held.ein,
        city: 'unknown',
        state: held.state,
        nteeCode: held.nteeCode,
        annualRevenueDollars: held.revenueCents / 100,
      });
      if (!parsed.ok) {
        // Counted and named, never skipped quietly: a sample that shrinks in silence turns
        // a measurement into an average over whatever happened to work.
        unmeasurable.push(`${held.ein} ${held.name}: ${parsed.error.message}`);
        continue;
      }

      const listing = await scorer.execute(parsed.value);
      if (!listing.ok) {
        unmeasurable.push(`${held.ein} ${held.name}: ${listing.error.message}`);
        continue;
      }

      const surfaced = new Set(listing.value.prospects.slice(0, TOP_N).map((p) => p.funderEin));
      const recovered = [...held.trueFunders].filter((funder) => surfaced.has(funder)).length;
      const recall = recovered / held.trueFunders.size;
      recalls.push(recall);

      console.log(
        `  ${held.name.slice(0, 40).padEnd(40)} ${recovered}/${held.trueFunders.size} real funders ` +
          `in top ${TOP_N} (${(recall * 100).toFixed(0)}%)`,
      );
    }

    if (unmeasurable.length > 0) {
      console.log(`\n${unmeasurable.length} organisations could not be measured:`);
      for (const reason of unmeasurable) console.log(`  ${reason}`);
    }

    // Stated coverage, as everywhere else: the number this average is over is part of the
    // result. A sample quietly reduced to two organisations would not be evidence.
    await recordEvalRun(db, 'held_out_organisations_measured', recalls.length, 'irs_2025_corpus');
    expect(recalls.length).toBeGreaterThanOrEqual(
      thresholds.held_out_funder_recovery.organisations_measured_floor,
    );

    const meanRecall = recalls.reduce((sum, value) => sum + value, 0) / recalls.length;

    await recordEvalRun(db, 'held_out_funder_recall_at_50', meanRecall, 'irs_2025_corpus');
    console.log(
      `mean recall@${TOP_N} across ${recalls.length} organisations: ${(meanRecall * 100).toFixed(1)}%`,
    );

    expect(meanRecall).toBeGreaterThanOrEqual(thresholds.held_out_funder_recovery.recall_at_50_floor);
  });
});
