import type { Result } from '@merit/shared';
import type { MilestoneKind } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

export interface ScheduledMilestoneRecord {
  readonly dedupeKey: string;
  readonly organizationId: string;
  readonly opportunityId: string;
  readonly kind: MilestoneKind;
  readonly label: string;
  readonly dueDate: string;
  readonly calendarEventId: string | null;
  readonly approvedAt: string | null;
}

export interface MilestoneRepository {
  upsertMilestones(records: readonly ScheduledMilestoneRecord[]): Promise<Result<number, RepositoryUnavailable>>;
  listDueMilestones(organizationId: string, dueBeforeIso: string): Promise<Result<readonly ScheduledMilestoneRecord[], RepositoryUnavailable>>;
}
