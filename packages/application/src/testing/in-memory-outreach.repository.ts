import { err, ok, type Result } from '@merit/shared';
import type {
  OutreachRecord,
  OutreachRepository,
  OutreachTargetKind,
} from '../ports/outreach-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

/**
 * An in-memory fake for the outreach tracker. It preserves the one property the screen and
 * future Gmail sync depend on: one record per (organisation, target, kind), overwritten rather
 * than accumulated.
 */
export class InMemoryOutreachRepository implements OutreachRepository {
  private readonly outreaches = new Map<string, OutreachRecord>();
  private failsOnce = false;

  failNextQuery(): void {
    this.failsOnce = true;
  }

  private guard<T>(operation: string): Result<T, RepositoryUnavailable> | null {
    if (!this.failsOnce) return null;
    this.failsOnce = false;
    return err(new RepositoryUnavailable('outreach query failed', { operation, table: 'outreach_threads' }));
  }

  async upsertOutreach(
    record: Omit<OutreachRecord, 'savedAt'>,
  ): Promise<Result<void, RepositoryUnavailable>> {
    const failure = this.guard<void>('upsertOutreach');
    if (failure !== null) return failure;

    this.outreaches.set(keyOf(record.organizationId, record.targetId, record.targetKind), {
      ...record,
      savedAt: '2026-08-08T00:00:00.000Z',
    });
    return ok(undefined);
  }

  async findOutreach(
    organizationId: string,
    targetId: string,
    targetKind: OutreachTargetKind,
  ): Promise<Result<OutreachRecord | null, RepositoryUnavailable>> {
    const failure = this.guard<OutreachRecord | null>('findOutreach');
    if (failure !== null) return failure;

    return ok(this.outreaches.get(keyOf(organizationId, targetId, targetKind)) ?? null);
  }

  async listOutreaches(
    organizationId?: string,
  ): Promise<Result<readonly OutreachRecord[], RepositoryUnavailable>> {
    const failure = this.guard<readonly OutreachRecord[]>('listOutreaches');
    if (failure !== null) return failure;

    const rows = [...this.outreaches.values()].filter(
      (record) => organizationId === undefined || record.organizationId === organizationId,
    );
    return ok(rows);
  }
}

const keyOf = (organizationId: string, targetId: string, targetKind: OutreachTargetKind): string =>
  `${organizationId}:${targetKind}:${targetId}`;
