import type { Result } from '@merit/shared';
import type { EligibilityScreening, FederalOpportunity, FitAssessment } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

/**
 * What happened to the fit score for one (organisation, opportunity) pair.
 *
 * `queued` is the third state degradation requires: neither a score nor an error, but work the
 * system has recorded and will do when quota allows. The UI says "not scored yet" rather than
 * showing a zero or an empty space, and the queue survives a restart because it is a column,
 * not an array in memory.
 */
export type FitState = 'scored' | 'queued' | 'not_applicable';

export interface StoredAssessment {
  readonly organizationId: string;
  readonly opportunityId: string;
  readonly screening: EligibilityScreening;
  readonly fit: FitAssessment | null;
  readonly fitState: FitState;
  readonly fitStateReason: string | null;
  readonly assessedAt: string;
}

export interface BoardRow {
  readonly opportunity: FederalOpportunity;
  /** Null when this pair has never been assessed -- a first visit, before the screen runs. */
  readonly assessment: StoredAssessment | null;
}

/** The sweep's own counters, written once per run. */
export interface SweepRun {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly searchesRun: number;
  readonly hitsSeen: number;
  readonly opportunitiesInserted: number;
  readonly opportunitiesUpdated: number;
  /** Hits whose detail could not be read. Counted, never silently dropped. */
  readonly parseFaults: number;
}

export interface OpportunityRepository {
  /**
   * Idempotent on the Grants.gov opportunity id: the same announcement ingested twice is one
   * row, with the later fetch's fields winning. A daily sweep re-reads most of what it read
   * yesterday, so this is the property that makes the job cheap rather than duplicating.
   */
  upsertOpportunities(
    opportunities: readonly FederalOpportunity[],
  ): Promise<Result<{ readonly inserted: number; readonly updated: number }, RepositoryUnavailable>>;

  listOpportunities(limit: number): Promise<Result<readonly FederalOpportunity[], RepositoryUnavailable>>;

  /** One announcement by its Grants.gov id. Null when the sweep has never seen it — a URL can
   *  name anything, and drafting against an announcement we do not hold is not a thing to do. */
  findOpportunity(id: string): Promise<Result<FederalOpportunity | null, RepositoryUnavailable>>;

  saveAssessments(assessments: readonly StoredAssessment[]): Promise<Result<number, RepositoryUnavailable>>;

  loadBoard(
    organizationId: string,
    limit: number,
  ): Promise<Result<readonly BoardRow[], RepositoryUnavailable>>;

  recordSweep(run: SweepRun): Promise<Result<void, RepositoryUnavailable>>;

  latestSweep(): Promise<Result<SweepRun | null, RepositoryUnavailable>>;
}
