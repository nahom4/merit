import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import type { NotificationKind, NotificationRecord, NotificationRepository } from '@merit/application';
import { RepositoryUnavailable } from '@merit/application';
import type { Database } from './database.js';

const NotificationRowSchema = z.object({
  dedupe_key: z.string(),
  kind: z.enum(['high_fit_alert', 'at_risk_warning', 'weekly_briefing']),
  organization_id: z.string(),
  opportunity_id: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  sent_at: z.string(),
});

export class LibsqlNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Database) {}

  async reserveNotification(
    record: Omit<NotificationRecord, 'sentAt'>,
  ): Promise<Result<boolean, RepositoryUnavailable>> {
    try {
      const sentAt = new Date().toISOString();
      const written = await this.db.execute({
        sql: `INSERT INTO scheduled_notifications
                (dedupe_key, kind, organization_id, opportunity_id, subject, body, sent_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (dedupe_key) DO NOTHING`,
        args: [
          record.dedupeKey,
          record.kind,
          record.organizationId,
          record.opportunityId,
          record.subject,
          record.body,
          sentAt,
        ],
      });
      return ok(written.rowsAffected > 0);
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'reserveNotification',
          table: 'scheduled_notifications',
        }),
      );
    }
  }

  async listNotifications(
    organizationId: string,
    kind: NotificationKind,
  ): Promise<Result<readonly NotificationRecord[], RepositoryUnavailable>> {
    try {
      const rows = await this.db.execute({
        sql: `SELECT dedupe_key, kind, organization_id, opportunity_id, subject, body, sent_at
              FROM scheduled_notifications
              WHERE organization_id = ? AND kind = ?
              ORDER BY sent_at DESC`,
        args: [organizationId, kind],
      });
      return ok(
        rows.rows.map((row) => {
          const parsed = NotificationRowSchema.parse(row);
          return {
            dedupeKey: parsed.dedupe_key,
            kind: parsed.kind,
            organizationId: parsed.organization_id,
            opportunityId: parsed.opportunity_id,
            subject: parsed.subject,
            body: parsed.body,
            sentAt: parsed.sent_at,
          };
        }),
      );
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'listNotifications',
          table: 'scheduled_notifications',
        }),
      );
    }
  }
}
