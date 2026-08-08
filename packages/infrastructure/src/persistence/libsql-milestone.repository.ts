import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import type { MilestoneRepository, ScheduledMilestoneRecord } from '@merit/application';
import { RepositoryUnavailable } from '@merit/application';
import type { Database } from './database.js';

const MilestoneRowSchema = z.object({
  dedupe_key: z.string(),
  organization_id: z.string(),
  opportunity_id: z.string(),
  milestone_kind: z.string(),
  label: z.string(),
  due_date: z.string(),
  calendar_event_id: z.string().nullable(),
  approved_at: z.string().nullable(),
});

export class LibsqlMilestoneRepository implements MilestoneRepository {
  constructor(private readonly db: Database) {}

  async upsertMilestones(
    records: readonly ScheduledMilestoneRecord[],
  ): Promise<Result<number, RepositoryUnavailable>> {
    if (records.length === 0) return ok(0);
    try {
      const transaction = await this.db.transaction('write');
      try {
        for (const record of records) {
          await transaction.execute({
            sql: `INSERT INTO scheduled_milestones
                    (dedupe_key, organization_id, opportunity_id, milestone_kind, label, due_date, calendar_event_id, approved_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (dedupe_key) DO UPDATE SET
                    organization_id = excluded.organization_id,
                    opportunity_id = excluded.opportunity_id,
                    milestone_kind = excluded.milestone_kind,
                    label = excluded.label,
                    due_date = excluded.due_date,
                    calendar_event_id = excluded.calendar_event_id,
                    approved_at = excluded.approved_at`,
            args: [
              record.dedupeKey,
              record.organizationId,
              record.opportunityId,
              record.kind,
              record.label,
              record.dueDate,
              record.calendarEventId,
              record.approvedAt,
            ],
          });
        }
        await transaction.commit();
      } catch (cause) {
        await transaction.rollback();
        throw cause;
      }
      return ok(records.length);
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'upsertMilestones',
          table: 'scheduled_milestones',
        }),
      );
    }
  }

  async listDueMilestones(
    organizationId: string,
    dueBeforeIso: string,
  ): Promise<Result<readonly ScheduledMilestoneRecord[], RepositoryUnavailable>> {
    try {
      const rows = await this.db.execute({
        sql: `SELECT dedupe_key, organization_id, opportunity_id, milestone_kind, label, due_date, calendar_event_id, approved_at
              FROM scheduled_milestones
              WHERE organization_id = ? AND approved_at IS NOT NULL AND due_date <= ?
              ORDER BY due_date ASC`,
        args: [organizationId, dueBeforeIso],
      });
      return ok(
        rows.rows.map((row) => {
          const parsed = MilestoneRowSchema.parse(row);
          return {
            dedupeKey: parsed.dedupe_key,
            organizationId: parsed.organization_id,
            opportunityId: parsed.opportunity_id,
            kind: parsed.milestone_kind as ScheduledMilestoneRecord['kind'],
            label: parsed.label,
            dueDate: parsed.due_date,
            calendarEventId: parsed.calendar_event_id,
            approvedAt: parsed.approved_at,
          };
        }),
      );
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'listDueMilestones',
          table: 'scheduled_milestones',
        }),
      );
    }
  }
}
