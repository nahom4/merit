import { err, ok, type Result } from '@merit/shared';
import type { MilestoneRepository, ScheduledMilestoneRecord } from '../ports/milestone-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

export class InMemoryMilestoneRepository implements MilestoneRepository {
  private readonly milestones = new Map<string, ScheduledMilestoneRecord>();
  private failsOnce = false;

  failNext(): void {
    this.failsOnce = true;
  }

  async upsertMilestones(
    records: readonly ScheduledMilestoneRecord[],
  ): Promise<Result<number, RepositoryUnavailable>> {
    if (this.failsOnce) {
      this.failsOnce = false;
      return err(new RepositoryUnavailable('milestone write failed', { operation: 'upsertMilestones' }));
    }
    for (const record of records) this.milestones.set(record.dedupeKey, record);
    return ok(records.length);
  }

  async listDueMilestones(
    organizationId: string,
    dueBeforeIso: string,
  ): Promise<Result<readonly ScheduledMilestoneRecord[], RepositoryUnavailable>> {
    if (this.failsOnce) {
      this.failsOnce = false;
      return err(new RepositoryUnavailable('milestone read failed', { operation: 'listDueMilestones' }));
    }
    return ok(
      [...this.milestones.values()].filter(
        (record) =>
          record.organizationId === organizationId && record.approvedAt !== null && record.dueDate <= dueBeforeIso,
      ),
    );
  }
}
