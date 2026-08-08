import { err, ok, type Result } from '@merit/shared';
import type { ReachabilityGrant, SharedFunderRow } from '@merit/domain';
import type { FunderProfile, FunderRepository } from '../ports/funder-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

/** One funder's whole footprint in the graph, as a unit test wants to state it. */
export interface FakeFunderRecord {
  readonly profile: FunderProfile;
  readonly grants: readonly ReachabilityGrant[];
  readonly sharedFunderPaths: readonly SharedFunderRow[];
}

/**
 * A hand-written fake, not a mock. It applies the same filters the SQL does -- paths are
 * returned only for peers the caller actually asked about -- so a unit test can pin what the
 * use case decides without a database deciding half of it.
 */
export class InMemoryFunderRepository implements FunderRepository {
  private funderQueryFailsOnce = false;
  private historyQueryFailsOnce = false;
  private pathQueryFailsOnce = false;

  constructor(private readonly records: readonly FakeFunderRecord[] = []) {}

  failNextFunderQuery(): void {
    this.funderQueryFailsOnce = true;
  }

  failNextHistoryQuery(): void {
    this.historyQueryFailsOnce = true;
  }

  failNextPathQuery(): void {
    this.pathQueryFailsOnce = true;
  }

  async findFunder(ein: string): Promise<Result<FunderProfile | null, RepositoryUnavailable>> {
    if (this.funderQueryFailsOnce) {
      this.funderQueryFailsOnce = false;
      return err(
        new RepositoryUnavailable('funder lookup failed', {
          operation: 'findFunder',
          table: 'funders',
        }),
      );
    }
    return ok(this.records.find((record) => record.profile.ein === ein)?.profile ?? null);
  }

  async loadGranteeHistory(
    funderEin: string,
  ): Promise<Result<readonly ReachabilityGrant[], RepositoryUnavailable>> {
    if (this.historyQueryFailsOnce) {
      this.historyQueryFailsOnce = false;
      return err(
        new RepositoryUnavailable('grantee history query failed', {
          operation: 'loadGranteeHistory',
          table: 'grant_records',
        }),
      );
    }
    return ok(this.records.find((record) => record.profile.ein === funderEin)?.grants ?? []);
  }

  async findSharedFunderPaths(
    funderEin: string,
    peerEins: readonly string[],
    limit: number,
  ): Promise<Result<readonly SharedFunderRow[], RepositoryUnavailable>> {
    if (this.pathQueryFailsOnce) {
      this.pathQueryFailsOnce = false;
      return err(
        new RepositoryUnavailable('shared funder path query failed', {
          operation: 'findSharedFunderPaths',
          table: 'entity_links',
        }),
      );
    }

    const peers = new Set(peerEins);
    const record = this.records.find((entry) => entry.profile.ein === funderEin);
    return ok((record?.sharedFunderPaths ?? []).filter((path) => peers.has(path.peerEin)).slice(0, limit));
  }
}
