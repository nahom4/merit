import type { Result } from '@merit/shared';
import type { RepositoryUnavailable } from '../errors.js';

export type OutreachTargetKind = 'federal' | 'foundation';
export type OutreachStatus = 'draft' | 'sent' | 'replied' | 'follow_up_needed';

export interface OutreachRecord {
  readonly organizationId: string;
  readonly targetId: string;
  readonly targetKind: OutreachTargetKind;
  readonly targetName: string;
  readonly contactEmail: string | null;
  readonly subject: string;
  readonly body: string;
  readonly status: OutreachStatus;
  readonly gmailMessageId: string | null;
  readonly gmailThreadId: string | null;
  readonly lastSyncedAt: string | null;
  /** When the two follow-up reminders were written to the calendar. Null means not yet. */
  readonly followUpsScheduledAt: string | null;
  readonly savedAt: string;
}

export interface OutreachRepository {
  upsertOutreach(record: Omit<OutreachRecord, 'savedAt'>): Promise<Result<void, RepositoryUnavailable>>;
  findOutreach(
    organizationId: string,
    targetId: string,
    targetKind: OutreachTargetKind,
  ): Promise<Result<OutreachRecord | null, RepositoryUnavailable>>;
  listOutreaches(organizationId?: string): Promise<Result<readonly OutreachRecord[], RepositoryUnavailable>>;
}
