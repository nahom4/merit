import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isErr, isOk, silentLogger } from '@merit/shared';
import { IngestBundle, type FilingSource } from '@merit/application';
import { LibsqlGrantRepository, parseFiling, streamBundle } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

const BUNDLE = join(process.cwd(), 'tests/fixtures/bundle-sample.zip');
/** The fixture bundle's organisation-to-organisation grants, established in bundle-stream.int.test.ts. */
const FIXTURE_TOTAL = 237;

/** Reads the real zip, parses real filings. `dieAfter` is the one piece of scaffolding: it
 *  reproduces the thing that cannot be arranged otherwise -- the stream failing part-way
 *  through, which is what a dropped IRS connection or a killed worker looks like from here. */
const source = (options: { dieAfter?: number } = {}): FilingSource => ({
  bundle: 'test-2025-01A',
  async *filings() {
    let seen = 0;
    for await (const entry of streamBundle(BUNDLE)) {
      if (options.dieAfter !== undefined && seen >= options.dieAfter) {
        throw new Error('connection reset by peer');
      }
      seen += 1;
      const filing = parseFiling(entry.xml, entry.irsObjectId);
      yield {
        irsObjectId: filing.irsObjectId,
        grants: filing.grants,
        parseFaults: filing.parseFaults,
        statedTotalCents: filing.statedTotalCents,
        grantsToIndividualsCents: filing.grantsToIndividualsCents,
      };
    }
  },
});

let database: FreshDatabase;
let ingest: IngestBundle;
let repository: LibsqlGrantRepository;

beforeEach(async () => {
  database = await freshDatabase();
  repository = new LibsqlGrantRepository(database.db);
  // Checkpoint every 10 filings: the fixture holds 60, and the default interval would
  // leave a killed run with nothing durable to resume from.
  ingest = new IngestBundle(repository, silentLogger, { checkpointEveryFilings: 10 });
});

afterEach(async () => {
  await database.destroy();
});

const countGrants = async (): Promise<number> => {
  const result = await repository.countGrants();
  return isOk(result) ? result.value : -1;
};

describe('IngestBundle', () => {
  it('writes every grant in a real bundle', async () => {
    const result = await ingest.execute(source());
    expect(isOk(result) && result.value.grantsWritten).toBe(FIXTURE_TOTAL);
    expect(await countGrants()).toBe(FIXTURE_TOTAL);
  });

  it('registers each funder alongside its grants', async () => {
    await ingest.execute(source());
    const funders = await database.db.execute('SELECT COUNT(*) AS n FROM funders');
    expect(Number(funders.rows[0]?.['n'])).toBeGreaterThan(10);
  });

  it('records the years a funder filed for', async () => {
    await ingest.execute(source());
    const rows = await database.db.execute(
      'SELECT first_tax_year, last_tax_year FROM funders WHERE first_tax_year IS NOT NULL LIMIT 1',
    );
    expect(Number(rows.rows[0]?.['first_tax_year'])).toBeGreaterThan(2000);
  });

  it('normalises the recipient string at write time, because every query joins on it', async () => {
    await ingest.execute(source());
    const rows = await database.db.execute(
      "SELECT recipient_normalized FROM grant_records WHERE recipient_normalized LIKE '%,%' LIMIT 1",
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('is idempotent: ingesting the same bundle twice leaves the same rows', async () => {
    await ingest.execute(source());
    const afterFirst = await countGrants();

    // Clear the checkpoint so the second run genuinely reprocesses rather than short-circuits.
    await database.db.execute('DELETE FROM ingest_checkpoints');
    await ingest.execute(source());

    expect(await countGrants()).toBe(afterFirst);
  });

  it('short-circuits a bundle already marked complete', async () => {
    await ingest.execute(source());
    const result = await ingest.execute(source());
    expect(isOk(result) && result.value.resumed).toBe(true);
    expect(await countGrants()).toBe(FIXTURE_TOTAL);
  });

  it('resumes from its checkpoint with no loss and no duplication', async () => {
    // The headline behaviour: the IRS server drops connections and workers get killed.
    const killed = await ingest.execute(source({ dieAfter: 25 }));
    expect(isErr(killed) && killed.error.code).toBe('ingest_interrupted');

    const partial = await countGrants();
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(FIXTURE_TOTAL);

    const resumed = await ingest.execute(source());

    expect(await countGrants()).toBe(FIXTURE_TOTAL);
    expect(isOk(resumed) && resumed.value.resumed).toBe(true);
  });

  it('counts every filing exactly once across a kill and a resume', async () => {
    await ingest.execute(source({ dieAfter: 25 }));
    await ingest.execute(source());
    const checkpoint = await repository.findCheckpoint('test-2025-01A');
    expect(isOk(checkpoint) && checkpoint.value?.filingsSeen).toBe(60);
  });

  it('leaves an interrupted bundle resumable rather than marking it complete', async () => {
    await ingest.execute(source({ dieAfter: 25 }));
    const checkpoint = await repository.findCheckpoint('test-2025-01A');
    expect(isOk(checkpoint) && checkpoint.value?.status).toBe('in_progress');
    expect(isOk(checkpoint) && checkpoint.value?.lastIrsObjectId).not.toBeNull();
  });

  it('does not re-write the grants it had already written before the interruption', async () => {
    await ingest.execute(source({ dieAfter: 25 }));
    const afterKill = await countGrants();
    const resumed = await ingest.execute(source());
    // The resumed run writes only what was missing, not the whole bundle again.
    expect(isOk(resumed) && resumed.value.grantsWritten).toBe(FIXTURE_TOTAL);
    expect(afterKill).toBeLessThan(FIXTURE_TOTAL);
  });

  it('refuses to complete a bundle whose checkpoint marker it never finds', async () => {
    // The checkpoint names a filing that is not in this bundle. Skipping to a marker that
    // never arrives would run the stream to the end and mark it done having written nothing.
    await database.db.execute({
      sql: `INSERT INTO ingest_checkpoints (bundle, status, filings_seen, grants_written, parse_faults,
              individuals_cents, reconciled_filings, reconciliation_faults, last_irs_object_id, updated_at)
            VALUES ('test-2025-01A', 'in_progress', 5, 10, 0, 0, 0, 0, 'not-in-this-bundle', ?)`,
      args: [new Date().toISOString()],
    });

    const result = await ingest.execute(source());

    expect(isErr(result) && result.error.code).toBe('ingest_interrupted');
    expect(await countGrants()).toBe(0);
  });

  it('resets the checkpoint after a lost marker so the next run reprocesses the bundle', async () => {
    await database.db.execute({
      sql: `INSERT INTO ingest_checkpoints (bundle, status, filings_seen, grants_written, parse_faults,
              individuals_cents, reconciled_filings, reconciliation_faults, last_irs_object_id, updated_at)
            VALUES ('test-2025-01A', 'in_progress', 5, 10, 0, 0, 0, 0, 'not-in-this-bundle', ?)`,
      args: [new Date().toISOString()],
    });

    await ingest.execute(source());
    const result = await ingest.execute(source());

    expect(isOk(result) && result.value.grantsWritten).toBe(FIXTURE_TOTAL);
    expect(await countGrants()).toBe(FIXTURE_TOTAL);
  });

  it('records the reconciliation result rather than assuming the extraction was clean', async () => {
    const result = await ingest.execute(source());
    expect(isOk(result) && result.value.reconciledFilings).toBeGreaterThan(10);
    expect(isOk(result) && result.value.reconciliationFaults / result.value.reconciledFilings).toBeLessThan(
      0.1,
    );
  });

  it('records the parse-fault count for the bundle', async () => {
    const result = await ingest.execute(source());
    expect(isOk(result) && result.value.parseFaults).toBe(0);
  });
});
