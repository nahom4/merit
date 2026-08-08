import type { Result } from '@merit/shared';
import type { GrantRecord } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

/** Progress through one bundle, durable across a killed process. */
export interface IngestCheckpoint {
  readonly bundle: string;
  readonly status: 'in_progress' | 'complete';
  readonly filingsSeen: number;
  readonly grantsWritten: number;
  readonly parseFaults: number;
  readonly individualsCents: number;
  readonly reconciledFilings: number;
  readonly reconciliationFaults: number;
  readonly lastIrsObjectId: string | null;
}

export interface GrantRepository {
  /**
   * Writes a batch idempotently, keyed on the grant's content identity. Re-ingesting a
   * bundle must be a no-op, so retries are safe by construction rather than by luck.
   */
  upsertGrants(grants: readonly GrantRecord[]): Promise<Result<number, RepositoryUnavailable>>;
  saveCheckpoint(checkpoint: IngestCheckpoint): Promise<Result<void, RepositoryUnavailable>>;
  findCheckpoint(bundle: string): Promise<Result<IngestCheckpoint | null, RepositoryUnavailable>>;
  countGrants(): Promise<Result<number, RepositoryUnavailable>>;
}
