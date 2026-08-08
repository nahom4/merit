import { ok, type Result } from '@merit/shared';
import {
  computeFunderSignals,
  computeProspectScore,
  materialityFloor,
  NteeCode,
  Organization,
  UsState,
  type Organization as OrganizationType,
} from '@merit/domain';
import type { CandidateFunder, ProspectRepository } from '../../ports/prospect-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';
import type {
  Prospect,
  ProspectCoverage,
  ProspectListingCache,
} from '../../ports/prospect-listing-cache.port.js';

export type { Prospect, ProspectCoverage } from '../../ports/prospect-listing-cache.port.js';

export interface ProspectListing {
  readonly organization: OrganizationType;
  readonly prospects: readonly Prospect[];
  readonly coverage: ProspectCoverage;
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
  constructor(
    private readonly prospects: ProspectRepository,
    /** Null in the eval harness, which wants the computation rather than yesterday's answer. */
    private readonly cache: ProspectListingCache | null = null,
  ) {}

  /**
   * The computed listing, and when it was computed.
   *
   * Scoring reads roughly 290,000 grant rows, so it is not something to do on every page load
   * for an answer that only changes when the profile or the corpus does. `refresh` is the
   * user's way of saying they know that and want it done again anyway.
   */
  async listing(
    organization: OrganizationType,
    options: { readonly refresh?: boolean } = {},
  ): Promise<Result<{ listing: ProspectListing; computedAt: string }, RepositoryUnavailable>> {
    const organizationId = organization.id as string;

    if (this.cache !== null && options.refresh !== true) {
      const cached = await this.cache.readCached(organizationId);
      if (!cached.ok) return cached;
      if (cached.value !== null) {
        return ok({
          listing: { organization, ...cached.value.payload },
          computedAt: cached.value.computedAt,
        });
      }
    }

    const computed = await this.execute(organization);
    if (!computed.ok) return computed;

    const computedAt = new Date().toISOString();
    if (this.cache !== null) {
      const written = await this.cache.writeCached(organizationId, {
        prospects: computed.value.prospects,
        coverage: computed.value.coverage,
      });
      if (!written.ok) return written;
    }
    return ok({ listing: computed.value, computedAt });
  }

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
