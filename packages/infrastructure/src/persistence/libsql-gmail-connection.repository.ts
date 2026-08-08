import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import type { GmailConnectionRecord, GmailConnectionRepository } from '@merit/application';
import { RepositoryUnavailable } from '@merit/application';
import type { Database } from './database.js';

const GmailConnectionRowSchema = z.object({
  account_id: z.string(),
  email_address: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  scope: z.string(),
  access_token_expires_at: z.string(),
  watch_expiration: z.string().nullable(),
  watch_topic_name: z.string().nullable(),
  last_synced_history_id: z.string(),
  last_synced_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export class LibsqlGmailConnectionRepository implements GmailConnectionRepository {
  constructor(private readonly db: Database) {}

  async getConnection(
    accountId: string,
  ): Promise<Result<GmailConnectionRecord | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM gmail_connections WHERE account_id = ?',
        args: [accountId],
      });
      const row = result.rows[0];
      if (row === undefined) return ok(null);
      const parsed = GmailConnectionRowSchema.parse(row);
      return ok({
        accountId: parsed.account_id,
        emailAddress: parsed.email_address,
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
        tokenType: parsed.token_type,
        scope: parsed.scope,
        accessTokenExpiresAt: parsed.access_token_expires_at,
        watchExpiration: parsed.watch_expiration,
        watchTopicName: parsed.watch_topic_name,
        lastSyncedHistoryId: parsed.last_synced_history_id,
        lastSyncedAt: parsed.last_synced_at,
        createdAt: parsed.created_at,
        updatedAt: parsed.updated_at,
      });
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'getConnection',
          table: 'gmail_connections',
        }),
      );
    }
  }

  async saveConnection(record: GmailConnectionRecord): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO gmail_connections (
                account_id, email_address, access_token, refresh_token, token_type, scope,
                access_token_expires_at, watch_expiration, watch_topic_name,
                last_synced_history_id, last_synced_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (account_id) DO UPDATE SET
                email_address = excluded.email_address,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_type = excluded.token_type,
                scope = excluded.scope,
                access_token_expires_at = excluded.access_token_expires_at,
                watch_expiration = excluded.watch_expiration,
                watch_topic_name = excluded.watch_topic_name,
                last_synced_history_id = excluded.last_synced_history_id,
                last_synced_at = excluded.last_synced_at,
                updated_at = excluded.updated_at`,
        args: [
          record.accountId,
          record.emailAddress,
          record.accessToken,
          record.refreshToken,
          record.tokenType,
          record.scope,
          record.accessTokenExpiresAt,
          record.watchExpiration,
          record.watchTopicName,
          record.lastSyncedHistoryId,
          record.lastSyncedAt,
          record.createdAt,
          record.updatedAt,
        ],
      });
      return ok(undefined);
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'saveConnection',
          table: 'gmail_connections',
        }),
      );
    }
  }
}
