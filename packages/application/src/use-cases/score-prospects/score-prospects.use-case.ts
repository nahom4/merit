import { ok, type Result } from '@merit/shared';
import {
  computeFunderSignals,
  computeProspectScore,
  materialityFloor,
  NteeCode,
  Organization,
  UsState,
  type FunderSignals,
  type Organization as OrganizationType,
  type ProspectScore,
} from '@merit/domain';
import type {
  CandidateFunder,
  PeerGranteeEvidence,
  ProspectRepository,
} from '../../ports/prospect-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';

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

export interface ProspectListing {
  readonly organization: OrganizationType;
  readonly prospects: readonly Prospect[];
  /**
   * Coverage, stated rather than implied. "12 comparable organisations found" is a claim
   * the interface must make; silence would imply completeness we cannot promise.
   */
  readonly coverage: {
    readonly peersFound: number;
    readonly candidateFundersConsidered: number;
    readonly credibleFunders: number;
    readonly materialityFloorCents: number;
  };
}

/**
 * Peer revenue band. A $656k literacy council and a $40M university are not comparable, and
 * the funders that serve them do not overlap. Half to four times revenue is wide enough to
 * find peers for a small organisation and narrow enough to keep the set meaningful.
 */
const PEER_REVENUE_LOWER = 0.5;
const PEER_REVENUE_UPPER = 4;

/**
 * Signals are computed from a funder's full grant history, so the candidate set is capped.
 * The cap is reported as coverage rather than hidden: the user is told how many funders
 * were considered.
 */
const MAX_CANDIDATE_FUNDERS = 400;

/**
 * The product. A real nonprofit profile in, a ranked list of credible funders out, each with
 * four separate score components and the grantee rows behind them.
 */
export class ScoreProspects {
  constructor(private readonly prospects: ProspectRepository) {}

  async execute(organization: OrganizationType): Promise<Result<ProspectListing, RepositoryUnavailable>> {
    const revenue = organization.annualRevenue as number;
    const floor = materialityFloor(organization.annualRevenue) as number;
    const majorGroup = NteeCode.majorGroup(organization.nteeCode);
    const region = [...Organization.region(organization)];

    const peers = await this.prospects.findPeers({
      nteeMajorGroup: majorGroup,
      // An organisation with no revenue on file would otherwise match only other zeroes.
      minRevenueCents: Math.floor(revenue * PEER_REVENUE_LOWER),
      maxRevenueCents: Math.ceil(Math.max(revenue, 1) * PEER_REVENUE_UPPER),
      excludeEin: organization.ein as string,
    });
    if (!peers.ok) return peers;

    const candidates = await this.prospects.findCandidateFunders(
      peers.value.map((peer) => peer.ein),
      region,
      MAX_CANDIDATE_FUNDERS,
    );
    if (!candidates.ok) return candidates;

    const histories = await this.prospects.loadFunderHistories(
      candidates.value.map((candidate) => candidate.ein),
      majorGroup,
    );
    if (!histories.ok) return histories;

    const historyByFunder = new Map(histories.value.map((history) => [history.funderEin, history]));

    const scored: Prospect[] = [];
    for (const candidate of candidates.value) {
      const history = historyByFunder.get(candidate.ein);
      if (history === undefined) continue;

      const signals = computeFunderSignals(history.grants);
      const score = computeProspectScore({
        signals,
        peerGranteeCount: candidate.peerGranteeCount,
        regionalGranteeCount: candidate.regionalGranteeCount,
        sameProgramGranteeShare: history.sameProgramGranteeShare,
        organizationState: UsState.toString(organization.state),
        organizationRegion: Organization.region(organization),
        organizationRevenueCents: revenue,
        materialityFloorCents: floor,
      });

      scored.push({
        funderEin: candidate.ein,
        funderName: candidate.name,
        funderState: candidate.state,
        score,
        signals,
        peerGranteeCount: candidate.peerGranteeCount,
        regionalGranteeCount: candidate.regionalGranteeCount,
        evidence: candidate.peerGrantees,
      });
    }

    const credible = scored.filter((prospect) => prospect.score.isCredible);

    return ok({
      organization,
      // Regional funders first: a foundation twenty miles away is a better prospect than a
      // national one with an identical score, and the validation run ranked the same way.
      prospects: credible.sort(byRegionThenScore),
      coverage: {
        peersFound: peers.value.length,
        candidateFundersConsidered: candidates.value.length,
        credibleFunders: credible.length,
        materialityFloorCents: floor,
      },
    });
  }
}

const byRegionThenScore = (a: Prospect, b: Prospect): number => {
  const aRegional = a.regionalGranteeCount > 0 ? 1 : 0;
  const bRegional = b.regionalGranteeCount > 0 ? 1 : 0;
  if (aRegional !== bRegional) return bRegional - aRegional;
  return b.score.total - a.score.total;
};

export const isCandidateRegional = (candidate: CandidateFunder): boolean =>
  candidate.regionalGranteeCount > 0;
