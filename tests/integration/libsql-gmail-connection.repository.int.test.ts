import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibsqlGmailConnectionRepository } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

let database: FreshDatabase;

beforeAll(async () => {
  database = await freshDatabase();
});

afterAll(async () => {
  await database.destroy();
});

describe('LibsqlGmailConnectionRepository', () => {
  it('round-trips the mailbox connection state', async () => {
    const repository = new LibsqlGmailConnectionRepository(database.db);
    const now = new Date().toISOString();
    const saved = await repository.saveConnection({
      accountId: 'primary',
      emailAddress: 'sender@example.com',
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      scope: 'gmail.modify',
      accessTokenExpiresAt: now,
      watchExpiration: now,
      watchTopicName: 'projects/test/topics/gmail',
      lastSyncedHistoryId: '101',
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(saved.ok).toBe(true);

    const loaded = await repository.getConnection('primary');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.emailAddress).toBe('sender@example.com');
    expect(loaded.value.watchExpiration).toBe(now);
    expect(loaded.value.lastSyncedHistoryId).toBe('101');
  });

  it('stores a mailbox connected without a Pub/Sub watch', async () => {
    // The local-development shape: authorized and syncable on demand, with nothing to push to.
    const repository = new LibsqlGmailConnectionRepository(database.db);
    const now = new Date().toISOString();
    const saved = await repository.saveConnection({
      accountId: 'primary',
      emailAddress: 'nowatch@example.com',
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      scope: 'gmail.modify',
      accessTokenExpiresAt: now,
      watchExpiration: null,
      watchTopicName: null,
      lastSyncedHistoryId: '900',
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(saved.ok).toBe(true);

    const loaded = await repository.getConnection('primary');
    if (!loaded.ok || loaded.value === null) throw new Error('the connection went missing');
    expect(loaded.value.watchTopicName).toBeNull();
    expect(loaded.value.watchExpiration).toBeNull();
    expect(loaded.value.lastSyncedHistoryId).toBe('900');
  });
});
