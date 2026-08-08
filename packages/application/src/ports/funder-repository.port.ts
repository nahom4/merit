import type { Result } from '@merit/shared';
import type { ReachabilityGrant, SharedFunderRow } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

/** A funder as the giving graph knows it, before any of its behaviour is computed. */
export interface FunderProfile {
  readonly ein: string;
  readonly name: string;
  readonly state: string | null;
  /** Which returns its grants were extracted from: `990PF`, `990SchI`, or both. */
  readonly sourceForms: string;
  readonly firstTaxYear: number | null;
  readonly lastTaxYear: number | null;
}

export interface FunderRepository {
  findFunder(ein: string): Promise<Result<FunderProfile | null, RepositoryUnavailable>>;

  /**
   * Every grant this funder made, with the grantee detail the report needs: registry name,
   * state, program area, and revenue where the recipient resolved. Unresolved recipients are
   * kept -- they still carry a year, an amount, and usually a state, and dropping them would
   * make every funder look smaller than its filings show.
   */
  loadGranteeHistory(funderEin: string): Promise<Result<readonly ReachabilityGrant[], RepositoryUnavailable>>;

  /**
   * Edges of the form `peer ← intermediary funder → this funder's grantee`: the raw material
   * for shared-funder proximity. Bounded by `limit`, because a large funder's second-degree
   * neighbourhood is most of the graph.
   */
  findSharedFunderPaths(
    funderEin: string,
    peerEins: readonly string[],
    limit: number,
  ): Promise<Result<readonly SharedFunderRow[], RepositoryUnavailable>>;
}
