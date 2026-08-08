import type { Result } from '@merit/shared';
import type { FunderSignals, ProspectScore } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';
import type { PeerGranteeEvidence } from './prospect-repository.port.js';

export interface Prospect {
  readonly funderEin: string;
  readonly funderName: string;
  readonly funderState: string | null;
  readonly score: ProspectScore;
  readonly signals: FunderSignals;
  readonly peerGranteeCount: number;
  readonly regionalGranteeCount: number;
  /** The grantee rows behind the score. Expandable from any component in the UI. */
  readonly evidence: readonly PeerGranteeEvidence[];
}

export interface ProspectCoverage {
  /**
   * Coverage, stated rather than implied. "12 comparable organisations found" is a claim
   * the interface must make; silence would imply completeness we cannot promise.
   */
  readonly peersFound: number;
  readonly candidateFundersConsidered: number;
  readonly credibleFunders: number;
  readonly materialityFloorCents: number;
}

/** Everything in a listing except the organisation, which is read live rather than cached. */
export interface CachedListingPayload {
  readonly prospects: readonly Prospect[];
  readonly coverage: ProspectCoverage;
}

export interface CachedProspectListing {
  readonly payload: CachedListingPayload;
  readonly computedAt: string;
}

export interface ProspectListingCache {
  readCached(organizationId: string): Promise<Result<CachedProspectListing | null, RepositoryUnavailable>>;
  writeCached(
    organizationId: string,
    payload: CachedListingPayload,
  ): Promise<Result<void, RepositoryUnavailable>>;
}
