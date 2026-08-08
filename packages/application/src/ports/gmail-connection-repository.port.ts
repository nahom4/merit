import type { Result } from '@merit/shared';
import type { RepositoryUnavailable } from '../errors.js';

export interface GmailConnectionRecord {
  readonly accountId: string;
  readonly emailAddress: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly scope: string;
  readonly accessTokenExpiresAt: string;
  /** Null when no Pub/Sub watch is registered: the mailbox is synced on demand instead. */
  readonly watchExpiration: string | null;
  readonly watchTopicName: string | null;
  readonly lastSyncedHistoryId: string;
  readonly lastSyncedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GmailConnectionRepository {
  getConnection(accountId: string): Promise<Result<GmailConnectionRecord | null, RepositoryUnavailable>>;
  saveConnection(record: GmailConnectionRecord): Promise<Result<void, RepositoryUnavailable>>;
}
