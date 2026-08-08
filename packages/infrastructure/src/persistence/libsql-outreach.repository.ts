import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import type { OutreachRecord, OutreachRepository, OutreachTargetKind } from '@merit/application';
import { RepositoryUnavailable } from '@merit/application';
import type { Database } from './database.js';

const OutreachRowSchema = z.object({
  organization_id: z.string(),
  target_id: z.string(),
  target_kind: z.enum(['federal', 'foundation']),
  target_name: z.string(),
  contact_email: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  status: z.enum(['draft', 'sent', 'replied', 'follow_up_needed']),
  gmail_message_id: z.string().nullable(),
  gmail_thread_id: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  follow_ups_scheduled_at: z.string().nullable(),
  saved_at: z.string(),
});

export class LibsqlOutreachRepository implements OutreachRepository {
  constructor(private readonly db: Database) {}

  async upsertOutreach(
    record: Omit<OutreachRecord, 'savedAt'>,
  ): Promise<Result<void, RepositoryUnavailable>> {
    try {
      const savedAt = new Date().toISOString();
      await this.db.execute({
        sql: `INSERT INTO outreach_threads (
                organization_id, target_id, target_kind, target_name, contact_email,
                subject, body, status, gmail_message_id, gmail_thread_id, last_synced_at,
                follow_ups_scheduled_at, saved_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (organization_id, target_id, target_kind) DO UPDATE SET
                target_name = excluded.target_name,
                contact_email = excluded.contact_email,
                subject = excluded.subject,
                body = excluded.body,
                status = excluded.status,
                gmail_message_id = excluded.gmail_message_id,
                gmail_thread_id = excluded.gmail_thread_id,
                last_synced_at = excluded.last_synced_at,
                follow_ups_scheduled_at = excluded.follow_ups_scheduled_at,
                saved_at = excluded.saved_at`,
        args: [
          record.organizationId,
          record.targetId,
          record.targetKind,
          record.targetName,
          record.contactEmail,
          record.subject,
          record.body,
          record.status,
          record.gmailMessageId,
          record.gmailThreadId,
          record.lastSyncedAt,
          record.followUpsScheduledAt,
          savedAt,
        ],
      });
      return ok(undefined);
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'upsertOutreach',
          table: 'outreach_threads',
        }),
      );
    }
  }

  async findOutreach(
    organizationId: string,
    targetId: string,
    targetKind: OutreachTargetKind,
  ): Promise<Result<OutreachRecord | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: `SELECT organization_id, target_id, target_kind, target_name, contact_email,
                     subject, body, status, gmail_message_id, gmail_thread_id,
                     last_synced_at, follow_ups_scheduled_at, saved_at
              FROM outreach_threads
              WHERE organization_id = ? AND target_id = ? AND target_kind = ?`,
        args: [organizationId, targetId, targetKind],
      });
      const row = result.rows[0];
      if (row === undefined) return ok(null);

      const parsed = OutreachRowSchema.parse(row);
      return ok({
        organizationId: parsed.organization_id,
        targetId: parsed.target_id,
        targetKind: parsed.target_kind,
        targetName: parsed.target_name,
        contactEmail: parsed.contact_email,
        subject: parsed.subject,
        body: parsed.body,
        status: parsed.status,
        gmailMessageId: parsed.gmail_message_id,
        gmailThreadId: parsed.gmail_thread_id,
        lastSyncedAt: parsed.last_synced_at,
        followUpsScheduledAt: parsed.follow_ups_scheduled_at,
        savedAt: parsed.saved_at,
      });
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'findOutreach',
          table: 'outreach_threads',
        }),
      );
    }
  }

  async listOutreaches(
    organizationId?: string,
  ): Promise<Result<readonly OutreachRecord[], RepositoryUnavailable>> {
    try {
      const result =
        organizationId === undefined
          ? await this.db.execute(`SELECT * FROM outreach_threads ORDER BY saved_at DESC`)
          : await this.db.execute({
              sql: `SELECT * FROM outreach_threads WHERE organization_id = ? ORDER BY saved_at DESC`,
              args: [organizationId],
            });

      return ok(
        result.rows.map((row) => {
          const parsed = OutreachRowSchema.parse(row);
          return {
            organizationId: parsed.organization_id,
            targetId: parsed.target_id,
            targetKind: parsed.target_kind,
            targetName: parsed.target_name,
            contactEmail: parsed.contact_email,
            subject: parsed.subject,
            body: parsed.body,
            status: parsed.status,
            gmailMessageId: parsed.gmail_message_id,
            gmailThreadId: parsed.gmail_thread_id,
            lastSyncedAt: parsed.last_synced_at,
            followUpsScheduledAt: parsed.follow_ups_scheduled_at,
            savedAt: parsed.saved_at,
          };
        }),
      );
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'listOutreaches',
          table: 'outreach_threads',
        }),
      );
    }
  }
}
