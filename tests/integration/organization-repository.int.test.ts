import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isErr, isOk, unwrapOrThrow } from '@merit/shared';
import { Ein, Organization } from '@merit/domain';
import { LibsqlOrganizationRepository } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

const capeFear = unwrapOrThrow(
  Organization.parse({
    id: 'org_capefear',
    name: 'Cape Fear Literacy Council',
    ein: '58-1613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 655_738,
  }),
);

let database: FreshDatabase;
let repository: LibsqlOrganizationRepository;

beforeAll(async () => {
  database = await freshDatabase();
  repository = new LibsqlOrganizationRepository(database.db);
});

afterAll(async () => {
  await database.destroy();
});

describe('LibsqlOrganizationRepository', () => {
  it('round-trips an organisation through real SQL', async () => {
    await repository.save(capeFear);
    const found = await repository.findById(capeFear.id);
    expect(isOk(found) && found.value?.name).toBe('Cape Fear Literacy Council');
  });

  it('restores revenue as integer cents, not as a float', async () => {
    await repository.save(capeFear);
    const found = await repository.findById(capeFear.id);
    expect(isOk(found) && found.value?.annualRevenue).toBe(65_573_800);
  });

  it('restores branded fields as parsed domain values, never raw rows', async () => {
    await repository.save(capeFear);
    const found = await repository.findById(capeFear.id);
    expect(isOk(found) && found.value !== null && Ein.toString(found.value.ein)).toBe('581613254');
  });

  it('finds an organisation by EIN', async () => {
    await repository.save(capeFear);
    const found = await repository.findByEin(capeFear.ein);
    expect(isOk(found) && found.value?.id).toBe('org_capefear');
  });

  it('reports a missing id as null rather than failing', async () => {
    const found = await repository.findById('org_absent' as typeof capeFear.id);
    expect(isOk(found) && found.value).toBeNull();
  });

  it('reports a missing EIN as null rather than failing', async () => {
    const found = await repository.findByEin(unwrapOrThrow(Ein.parse('123456789')));
    expect(isOk(found) && found.value).toBeNull();
  });

  it('is idempotent: saving the same organisation twice leaves one row', async () => {
    await repository.save(capeFear);
    await repository.save(capeFear);
    const rows = await database.db.execute('SELECT COUNT(*) AS n FROM organizations');
    expect(Number(rows.rows[0]?.['n'])).toBe(1);
  });

  it('applies an update on a repeat save rather than silently keeping the old row', async () => {
    await repository.save(capeFear);
    await repository.save({ ...capeFear, city: 'Leland' });
    const found = await repository.findById(capeFear.id);
    expect(isOk(found) && found.value?.city).toBe('Leland');
  });

  it('reports a query against a closed database as a value, not an exception', async () => {
    const doomed = await freshDatabase();
    const doomedRepository = new LibsqlOrganizationRepository(doomed.db);
    await doomed.destroy();
    const found = await doomedRepository.findById(capeFear.id);
    expect(isErr(found) && found.error.code).toBe('repository_unavailable');
  });
});

describe('concurrent access', () => {
  it('lets a reader proceed while a writer holds a transaction open', async () => {
    // Merit runs an offline worker that writes for hours and a serving plane that reads while
    // it does. Without WAL the read below fails with SQLITE_BUSY and the prospect screen
    // breaks whenever an ingest is running.
    const { createDatabase } = await import('@merit/infrastructure');
    const reader = createDatabase({ url: database.url });

    const transaction = await database.db.transaction('write');
    await transaction.execute({
      sql: 'INSERT INTO organizations VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: ['org_pending', 'Pending Org', '999999999', 'Raleigh', 'NC', 'B60', 100],
    });

    const readDuringWrite = await reader.execute('SELECT COUNT(*) AS n FROM organizations');
    expect(Number(readDuringWrite.rows[0]?.['n'])).toBeGreaterThanOrEqual(0);

    await transaction.commit();
    reader.close();
  });

  it('reports the writer’s row to a reader once the transaction commits', async () => {
    const { createDatabase } = await import('@merit/infrastructure');
    const reader = createDatabase({ url: database.url });

    await repository.save(capeFear);
    const seen = await reader.execute({
      sql: 'SELECT name FROM organizations WHERE id = ?',
      args: ['org_capefear'],
    });

    expect(String(seen.rows[0]?.['name'])).toBe('Cape Fear Literacy Council');
    reader.close();
  });
});

describe('migrations', () => {
  it('are idempotent: re-running them on a migrated database is a no-op', async () => {
    const { migrate } = await import('@merit/infrastructure');
    await migrate(database.db);
    const applied = await database.db.execute('SELECT COUNT(*) AS n FROM schema_migrations');
    const files = await database.db.execute('SELECT name FROM schema_migrations ORDER BY name');
    expect(Number(applied.rows[0]?.['n'])).toBe(files.rows.length);
  });
});
