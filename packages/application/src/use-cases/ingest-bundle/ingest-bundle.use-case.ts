import { DomainError, err, ok, type Logger, type Result } from '@merit/shared';
import type { GrantRecord } from '@merit/domain';
import type { GrantRepository, IngestCheckpoint } from '../../ports/grant-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';

/** The filing stream failed part-way through. Expected: connections drop and workers die. */
export class IngestInterrupted extends DomainError {
  readonly code = 'ingest_interrupted';
}

/** One parsed filing, as the infrastructure extractor produces it. */
export interface FilingToIngest {
  readonly irsObjectId: string;
  readonly grants: readonly GrantRecord[];
  readonly parseFaults: number;
  readonly statedTotalCents: number | null;
  readonly grantsToIndividualsCents: number;
}

/** The source of filings. A port, so the use case never knows about zip files or HTTP. */
export interface FilingSource {
  bundle: string;
  filings(): AsyncIterable<FilingToIngest>;
}

export interface IngestBundleResult {
  readonly bundle: string;
  readonly filingsSeen: number;
  readonly grantsWritten: number;
  readonly parseFaults: number;
  readonly reconciledFilings: number;
  readonly reconciliationFaults: number;
  readonly resumed: boolean;
}

export interface IngestBundleOptions {
  /** Flush and checkpoint at least this often, measured in grants. */
  readonly checkpointEveryGrants?: number;
  /**
   * ...and at least this often measured in filings. A bundle of small foundations can run
   * thousands of filings without accumulating a full grant batch, and a process killed in
   * that window would have nothing durable to resume from.
   */
  readonly checkpointEveryFilings?: number;
}

const DEFAULT_CHECKPOINT_GRANTS = 2_000;
const DEFAULT_CHECKPOINT_FILINGS = 500;

/**
 * A filing whose itemised rows differ from its own stated total by more than this is an
 * extraction fault. Measured and recorded per bundle rather than assumed to be zero --
 * losing data quietly is the worst failure mode this system has.
 */
const RECONCILIATION_TOLERANCE = 0.01;

export class IngestBundle {
  private readonly checkpointEveryGrants: number;
  private readonly checkpointEveryFilings: number;

  constructor(
    private readonly grants: GrantRepository,
    private readonly logger: Logger,
    options: IngestBundleOptions = {},
  ) {
    this.checkpointEveryGrants = options.checkpointEveryGrants ?? DEFAULT_CHECKPOINT_GRANTS;
    this.checkpointEveryFilings = options.checkpointEveryFilings ?? DEFAULT_CHECKPOINT_FILINGS;
  }

  async execute(
    source: FilingSource,
  ): Promise<Result<IngestBundleResult, RepositoryUnavailable | IngestInterrupted>> {
    const existing = await this.grants.findCheckpoint(source.bundle);
    if (!existing.ok) return existing;

    if (existing.value?.status === 'complete') {
      this.logger.info('bundle already ingested; nothing to do', { bundle: source.bundle });
      return ok({ ...summarise(existing.value), resumed: true });
    }

    // Resume where the last run stopped. Writes are idempotent, so replaying the filings
    // before this point would also be correct -- but on a 200MB bundle it is minutes wasted.
    const resumeAfter = existing.value?.lastIrsObjectId ?? null;
    let skipping = resumeAfter !== null;
    if (skipping) {
      this.logger.info('resuming bundle from checkpoint', {
        bundle: source.bundle,
        after: resumeAfter,
        grantsAlready: existing.value?.grantsWritten ?? 0,
      });
    }

    const progress: Mutable<IngestCheckpoint> = {
      bundle: source.bundle,
      status: 'in_progress',
      filingsSeen: existing.value?.filingsSeen ?? 0,
      grantsWritten: existing.value?.grantsWritten ?? 0,
      parseFaults: existing.value?.parseFaults ?? 0,
      individualsCents: existing.value?.individualsCents ?? 0,
      reconciledFilings: existing.value?.reconciledFilings ?? 0,
      reconciliationFaults: existing.value?.reconciliationFaults ?? 0,
      lastIrsObjectId: resumeAfter,
    };

    let batch: GrantRecord[] = [];
    let pendingObjectId: string | null = progress.lastIrsObjectId;

    const flush = async (): Promise<Result<void, RepositoryUnavailable>> => {
      if (batch.length > 0) {
        const written = await this.grants.upsertGrants(batch);
        if (!written.ok) return written;
        progress.grantsWritten += written.value;
        batch = [];
      }
      progress.lastIrsObjectId = pendingObjectId;
      return this.grants.saveCheckpoint({ ...progress });
    };

    let filingsSinceCheckpoint = 0;

    try {
      for await (const filing of source.filings()) {
        if (skipping) {
          // The stream is ordered, so everything up to and including the checkpointed filing
          // has already been written.
          if (filing.irsObjectId === resumeAfter) skipping = false;
          continue;
        }

        progress.filingsSeen += 1;
        progress.parseFaults += filing.parseFaults;
        progress.individualsCents += filing.grantsToIndividualsCents;

        if (filing.statedTotalCents !== null && filing.statedTotalCents > 0) {
          const summed =
            filing.grants.reduce((total, grant) => total + (grant.amount as number), 0) +
            filing.grantsToIndividualsCents;
          progress.reconciledFilings += 1;
          const divergence = Math.abs(summed - filing.statedTotalCents) / filing.statedTotalCents;
          if (divergence > RECONCILIATION_TOLERANCE) {
            progress.reconciliationFaults += 1;
            this.logger.warn('filing does not reconcile against its own stated total', {
              irsObjectId: filing.irsObjectId,
              statedTotalCents: filing.statedTotalCents,
              summedCents: summed,
            });
          }
        }

        batch.push(...filing.grants);
        pendingObjectId = filing.irsObjectId;
        filingsSinceCheckpoint += 1;

        if (
          batch.length >= this.checkpointEveryGrants ||
          filingsSinceCheckpoint >= this.checkpointEveryFilings
        ) {
          const flushed = await flush();
          if (!flushed.ok) return flushed;
          filingsSinceCheckpoint = 0;
        }
      }
    } catch (cause) {
      // The stream died -- a dropped connection, a corrupt entry, a killed worker. Whatever
      // is already durable stays durable and stays resumable; the run reports what happened
      // rather than leaving the bundle looking finished.
      await flush();
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.logger.warn('bundle ingest interrupted; checkpoint left resumable', {
        bundle: source.bundle,
        after: progress.lastIrsObjectId,
        grantsWritten: progress.grantsWritten,
        reason,
      });
      return err(
        new IngestInterrupted('bundle ingest was interrupted', {
          bundle: source.bundle,
          grantsWritten: progress.grantsWritten,
          reason,
        }),
      );
    }

    // The resume marker was never seen: the stream ran to the end still skipping. Either the
    // bundle changed under us or the checkpoint names a filing that is no longer in it.
    // Completing here would mark the bundle done having written nothing -- exactly the silent
    // data loss this system must not do.
    if (skipping) {
      progress.lastIrsObjectId = null;
      progress.filingsSeen = 0;
      progress.grantsWritten = 0;
      await this.grants.saveCheckpoint({ ...progress });
      this.logger.error('checkpoint marker not found in bundle; checkpoint reset for a full re-run', {
        bundle: source.bundle,
        marker: resumeAfter ?? 'none',
      });
      return err(
        new IngestInterrupted('resume marker was not found in the bundle', {
          bundle: source.bundle,
          marker: resumeAfter ?? 'none',
        }),
      );
    }

    const flushed = await flush();
    if (!flushed.ok) return flushed;

    progress.status = 'complete';
    const finished = await this.grants.saveCheckpoint({ ...progress });
    if (!finished.ok) return finished;

    this.logger.info('bundle ingested', {
      bundle: source.bundle,
      filings: progress.filingsSeen,
      grants: progress.grantsWritten,
      parseFaults: progress.parseFaults,
      reconciliationFaults: progress.reconciliationFaults,
    });

    return ok({ ...summarise(progress), resumed: resumeAfter !== null });
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const summarise = (checkpoint: IngestCheckpoint) => ({
  bundle: checkpoint.bundle,
  filingsSeen: checkpoint.filingsSeen,
  grantsWritten: checkpoint.grantsWritten,
  parseFaults: checkpoint.parseFaults,
  reconciledFilings: checkpoint.reconciledFilings,
  reconciliationFaults: checkpoint.reconciliationFaults,
});
