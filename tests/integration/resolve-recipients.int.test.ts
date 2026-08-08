import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '@merit/shared';
import { ResolveRecipients } from '@merit/application';
import { LibsqlEntityRepository, type Database } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';
import { seedGivingGraph } from '../support/seed-graph.js';

/**
 * Re-resolution against a real database.
 *
 * Thresholds are refitted whenever the scorer or the corpus changes, and the stored links
 * have to be rebuilt to match -- a graph resolved under one operating point and scored under
 * another is a graph nobody can reason about. The interesting question is what a rebuild is
 * allowed to destroy.
 */
let fresh: FreshDatabase;
let db: Database;

beforeAll(async () => {
  fresh = await freshDatabase();
  db = fresh.db;
  await seedGivingGraph(db);
}, 120_000);

afterAll(async () => {
  await fresh.destroy();
});

const resolver = (): ResolveRecipients => new ResolveRecipients(new LibsqlEntityRepository(db), silentLogger);

const countLinks = async (): Promise<number> => {
  const result = await db.execute('SELECT COUNT(*) AS n FROM entity_links');
  return Number(result.rows[0]?.['n'] ?? 0);
};

describe('ResolveRecipients re-resolution', () => {
  it('starts from a fully resolved graph', async () => {
    expect(await countLinks()).toBeGreaterThan(0);
  });

  it('does no work on a re-run, because nothing is unresolved', async () => {
    const result = await resolver().execute();
    expect(result.ok && result.value.considered).toBe(0);
  });

  it('re-decides every record when asked to reset', async () => {
    const before = await countLinks();
    const result = await resolver().execute({ reset: true });

    expect(result.ok && result.value.considered).toBe(before);
    expect(await countLinks()).toBe(before);
  });

  it('applies the thresholds it was given rather than the ones already stored', async () => {
    // A threshold nothing can clear: every scored record must come back rejected. If reset
    // were not clearing the old rows, the previous run's links would still be sitting there.
    const result = await resolver().execute({
      reset: true,
      thresholds: { link: 1.01, reject: 1.01, ambiguityMargin: 0 },
    });
    expect(result.ok).toBe(true);

    const linked = await db.execute(
      "SELECT COUNT(*) AS n FROM entity_links WHERE decision = 'linked' AND score_total < 1",
    );
    expect(Number(linked.rows[0]?.['n'])).toBe(0);
  });

  it('keeps a link a human reviewed, because a rebuild must not discard human work', async () => {
    await resolver().execute({ reset: true });

    const target = await db.execute(
      'SELECT grant_record_id FROM entity_links ORDER BY grant_record_id LIMIT 1',
    );
    const grantRecordId = target.rows[0]?.['grant_record_id'];
    if (grantRecordId === undefined) throw new Error('seed produced no links to review');

    await db.execute({
      sql: `UPDATE entity_links
            SET decision = 'linked', entity_ein = 'reviewed_by_hand',
                reviewed_by = 'a.person@example.org', reviewed_at = ?
            WHERE grant_record_id = ?`,
      args: [new Date().toISOString(), grantRecordId],
    });

    await resolver().execute({ reset: true });

    const after = await db.execute({
      sql: 'SELECT entity_ein, decision, reviewed_by FROM entity_links WHERE grant_record_id = ?',
      args: [grantRecordId],
    });
    expect(after.rows[0]?.['entity_ein']).toBe('reviewed_by_hand');
    expect(after.rows[0]?.['reviewed_by']).toBe('a.person@example.org');
  });
});
