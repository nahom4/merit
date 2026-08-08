import { err, ok, type Result } from '@merit/shared';
import type { GranteeGrant } from '@merit/domain';
import type {
  CandidateFunder,
  FunderGrantHistory,
  PeerEntity,
  PeerQuery,
  ProspectRepository,
} from '../ports/prospect-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

/**
 * A hand-written fake giving graph, not a mock. It applies the same peer rules the SQL does
 * -- program area, revenue band, exclude self, funded by somebody -- so a unit test can pin
 * what the use case decides without a database deciding half of it.
 */
export interface FakeFunder {
  readonly ein: string;
  readonly name: string;
  readonly state: string | null;
  readonly grants: readonly GranteeGrant[];
  /** Grantee EINs, of those in `grants`, that resolved to the requested program area. */
  readonly sameProgramGrantees?: readonly string[];
}

export class InMemoryProspectRepository implements ProspectRepository {
  private peerQueryFailsOnce = false;
  private candidateQueryFailsOnce = false;

  constructor(
    private readonly peers: readonly PeerEntity[] = [],
    private readonly funders: readonly FakeFunder[] = [],
  ) {}

  failNextPeerQuery(): void {
    this.peerQueryFailsOnce = true;
  }

  failNextCandidateQuery(): void {
    this.candidateQueryFailsOnce = true;
  }

  async findPeers(query: PeerQuery): Promise<Result<readonly PeerEntity[], RepositoryUnavailable>> {
    if (this.peerQueryFailsOnce) {
      this.peerQueryFailsOnce = false;
      return err(
        new RepositoryUnavailable('peer query failed', { operation: 'findPeers', table: 'entities' }),
      );
    }

    return ok(
      this.peers.filter(
        (peer) =>
          peer.ein !== query.excludeEin &&
          peer.nteeCode?.startsWith(query.nteeMajorGroup) === true &&
          peer.revenueCents !== null &&
          peer.revenueCents >= query.minRevenueCents &&
          peer.revenueCents <= query.maxRevenueCents,
      ),
    );
  }

  async findCandidateFunders(
    peerEins: readonly string[],
    region: readonly string[],
    limit: number,
  ): Promise<Result<readonly CandidateFunder[], RepositoryUnavailable>> {
    if (this.candidateQueryFailsOnce) {
      this.candidateQueryFailsOnce = false;
      return err(
        new RepositoryUnavailable('candidate query failed', {
          operation: 'findCandidateFunders',
          table: 'entity_links',
        }),
      );
    }

    const peerSet = new Set(peerEins);
    const stateOf = new Map(this.peers.map((peer) => [peer.ein, peer.state]));

    const candidates = this.funders
      .map((funder) => {
        const granteeEins = new Set(
          funder.grants.map((grant) => grant.granteeKey).filter((key) => peerSet.has(key)),
        );
        const regional = [...granteeEins].filter((ein) => {
          const state = stateOf.get(ein);
          return state !== null && state !== undefined && region.includes(state);
        });
        return {
          ein: funder.ein,
          name: funder.name,
          state: funder.state,
          peerGranteeCount: granteeEins.size,
          regionalGranteeCount: regional.length,
          peerGrantees: [...granteeEins].map((ein) => ({
            entityEin: ein,
            name: `Grantee ${ein}`,
            city: null,
            state: stateOf.get(ein) ?? null,
            taxYear: funder.grants.find((grant) => grant.granteeKey === ein)?.taxYear ?? 0,
            amountCents: funder.grants.find((grant) => grant.granteeKey === ein)?.amountCents ?? 0,
            purpose: null,
          })),
        };
      })
      .filter((candidate) => candidate.peerGranteeCount > 0)
      .sort((a, b) =>
        b.regionalGranteeCount !== a.regionalGranteeCount
          ? b.regionalGranteeCount - a.regionalGranteeCount
          : b.peerGranteeCount - a.peerGranteeCount,
      )
      .slice(0, limit);

    return ok(candidates);
  }

  async loadFunderHistories(
    funderEins: readonly string[],
    _nteeMajorGroup: string,
  ): Promise<Result<readonly FunderGrantHistory[], RepositoryUnavailable>> {
    const wanted = new Set(funderEins);
    return ok(
      this.funders
        .filter((funder) => wanted.has(funder.ein))
        .map((funder) => {
          const resolved = new Set(funder.grants.map((grant) => grant.granteeKey));
          const inGroup = funder.sameProgramGrantees ?? [];
          return {
            funderEin: funder.ein,
            grants: funder.grants,
            sameProgramGranteeShare: resolved.size === 0 ? 0 : inGroup.length / resolved.size,
          };
        }),
    );
  }
}
