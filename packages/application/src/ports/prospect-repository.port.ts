import type { Result } from '@merit/shared';
import type { GranteeGrant } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

/** How the peer set is defined: same program area, comparable size, resolved to the registry. */
export interface PeerQuery {
  readonly nteeMajorGroup: string;
  readonly minRevenueCents: number;
  readonly maxRevenueCents: number;
  readonly excludeEin: string;
}

export interface PeerEntity {
  readonly ein: string;
  readonly name: string;
  readonly state: string | null;
  readonly nteeCode: string | null;
  readonly revenueCents: number | null;
}

/** A funder that gave to at least one peer, with the evidence behind that claim. */
export interface CandidateFunder {
  readonly ein: string;
  readonly name: string;
  readonly state: string | null;
  readonly peerGranteeCount: number;
  readonly regionalGranteeCount: number;
  readonly peerGrantees: readonly PeerGranteeEvidence[];
}

/** The rows a user opens when they ask why a funder is on the list. */
export interface PeerGranteeEvidence {
  readonly entityEin: string;
  readonly name: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly taxYear: number;
  readonly amountCents: number;
  readonly purpose: string | null;
}

export interface FunderGrantHistory {
  readonly funderEin: string;
  readonly grants: readonly GranteeGrant[];
  /** Share of this funder's resolved grantees in the organisation's NTEE major group. */
  readonly sameProgramGranteeShare: number;
}

export interface ProspectRepository {
  findPeers(query: PeerQuery): Promise<Result<readonly PeerEntity[], RepositoryUnavailable>>;
  findCandidateFunders(
    peerEins: readonly string[],
    region: readonly string[],
    limit: number,
  ): Promise<Result<readonly CandidateFunder[], RepositoryUnavailable>>;
  loadFunderHistories(
    funderEins: readonly string[],
    nteeMajorGroup: string,
  ): Promise<Result<readonly FunderGrantHistory[], RepositoryUnavailable>>;
}
