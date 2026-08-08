import { err, ok, type Result } from '@merit/shared';
import {
  buildAffinityPaths,
  calibrateAsk,
  composeFunderBrief,
  computeFinancialTrend,
  computeReachability,
  materialityFloor,
  NteeCode,
  UsState,
  validateBrief,
  type AffinityPaths,
  type AskCalibration,
  type FinancialTrend,
  type FunderBrief,
  type FunderReachability,
  type Organization as OrganizationType,
} from '@merit/domain';
import type { FunderProfile, FunderRepository } from '../../ports/funder-repository.port.js';
import type { FunderFinancialsGateway } from '../../ports/funder-financials.port.js';
import type { ProspectRepository } from '../../ports/prospect-repository.port.js';
import { FunderNotFound } from '../../errors.js';
import type { RepositoryUnavailable } from '../../errors.js';

export interface ReportFunderReachabilityInput {
  readonly organization: OrganizationType;
  readonly funderEin: string;
}

export interface FunderReachabilityReport {
  readonly organization: OrganizationType;
  readonly funder: FunderProfile;
  readonly reachability: FunderReachability;
  readonly calibration: AskCalibration;
  readonly affinity: AffinityPaths;
  /** Null when ProPublica could not be read. `financialsError` then says why. */
  readonly financials: FinancialTrend | null;
  readonly financialsError: string | null;
  readonly brief: FunderBrief;
  readonly coverage: {
    readonly peersFound: number;
    readonly granteeRowsExamined: number;
    readonly sharedFunderEdgesExamined: number;
    readonly materialityFloorCents: number;
  };
}

export type ReportFunderReachabilityError = FunderNotFound | RepositoryUnavailable;

/** Matches the peer band used by `ScoreProspects`, so "an organisation like ours" means the
 *  same thing on the prospect list and on the report a user opens from it. */
const PEER_REVENUE_LOWER = 0.5;
const PEER_REVENUE_UPPER = 4;

/**
 * A large funder's second-degree neighbourhood is most of the graph. The cap is reported as
 * coverage rather than hidden, so a truncated path list never reads as a complete one.
 */
const MAX_SHARED_FUNDER_EDGES = 500;

/**
 * S2: should we bother with this funder.
 *
 * Everything here is arithmetic over filings, with one optional third-party source for the
 * financial trend. That source is allowed to fail -- the report is built and the absence is
 * stated -- because a page that dies when ProPublica has a bad afternoon is worse than a page
 * that says one section is missing.
 */
export class ReportFunderReachability {
  constructor(
    private readonly funders: FunderRepository,
    private readonly prospects: ProspectRepository,
    private readonly financials: FunderFinancialsGateway,
  ) {}

  async execute(
    input: ReportFunderReachabilityInput,
  ): Promise<Result<FunderReachabilityReport, ReportFunderReachabilityError>> {
    const { organization, funderEin } = input;

    const found = await this.funders.findFunder(funderEin);
    if (!found.ok) return found;
    if (found.value === null) {
      return err(new FunderNotFound('no funder with this EIN is in the giving graph', { ein: funderEin }));
    }
    const funder = found.value;

    const history = await this.funders.loadGranteeHistory(funderEin);
    if (!history.ok) return history;

    const revenue = organization.annualRevenue as number;
    const floor = materialityFloor(organization.annualRevenue) as number;

    const peers = await this.prospects.findPeers({
      nteeMajorGroup: NteeCode.majorGroup(organization.nteeCode),
      minRevenueCents: Math.floor(revenue * PEER_REVENUE_LOWER),
      maxRevenueCents: Math.ceil(Math.max(revenue, 1) * PEER_REVENUE_UPPER),
      excludeEin: organization.ein as string,
    });
    if (!peers.ok) return peers;

    // The graph walk and the ProPublica call need nothing from each other, and the slowest
    // page is not the place to wait for them in turn.
    const [paths, fetched] = await Promise.all([
      this.funders.findSharedFunderPaths(
        funderEin,
        peers.value.map((peer) => peer.ein),
        MAX_SHARED_FUNDER_EDGES,
      ),
      // The one place a failure is absorbed rather than returned. ProPublica is supplementary:
      // it enriches a report the IRS filings already support on their own.
      this.financials.fetchFinancials(funderEin),
    ]);
    if (!paths.ok) return paths;
    const financials = fetched.ok ? computeFinancialTrend(fetched.value) : null;
    const financialsError = fetched.ok ? null : fetched.error.message;

    const reachability = computeReachability(history.value);
    const calibration = calibrateAsk({
      grants: history.value,
      organizationRevenueCents: revenue,
      materialityFloorCents: floor,
    });
    const affinity = buildAffinityPaths(paths.value);

    const brief = composeFunderBrief({
      funderEin,
      funderName: funder.name,
      organizationName: organization.name,
      organizationState: UsState.toString(organization.state),
      grants: history.value,
      reachability,
      calibration,
      affinity,
      financials,
    });

    // Composition is supposed to make an uncited claim impossible. Checking anyway costs
    // nothing and makes the product rule enforced rather than intended; reaching the throw
    // means composition has a bug, which is exactly what a throw is for.
    const validated = validateBrief(brief);
    if (!validated.ok) throw validated.error;

    return ok({
      organization,
      funder,
      reachability,
      calibration,
      affinity,
      financials,
      financialsError,
      brief: validated.value,
      coverage: {
        peersFound: peers.value.length,
        granteeRowsExamined: history.value.length,
        sharedFunderEdgesExamined: paths.value.length,
        materialityFloorCents: floor,
      },
    });
  }
}
