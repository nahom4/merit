import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibsqlOutreachRepository } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

let database: FreshDatabase;

beforeAll(async () => {
  database = await freshDatabase();
});

afterAll(async () => {
  await database.destroy();
});

describe('LibsqlOutreachRepository', () => {
  it('round-trips an outreach record', async () => {
    const repository = new LibsqlOutreachRepository(database.db);
    const saved = await repository.upsertOutreach({
      organizationId: 'org_1',
      targetId: '561234567',
      targetKind: 'foundation',
      targetName: 'Smith Foundation',
      contactEmail: 'jane@smithfoundation.org',
      subject: 'Funding inquiry',
      body: 'Hello',
      status: 'draft',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: null,
      followUpsScheduledAt: null,
    });

    expect(saved.ok).toBe(true);

    const loaded = await repository.findOutreach('org_1', '561234567', 'foundation');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.targetName).toBe('Smith Foundation');
    expect(loaded.value.contactEmail).toBe('jane@smithfoundation.org');
    expect(loaded.value.status).toBe('draft');
  });
});
