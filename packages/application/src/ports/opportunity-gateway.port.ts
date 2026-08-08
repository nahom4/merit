import type { Result } from '@merit/shared';
import type { FederalOpportunity } from '@merit/domain';
import type { OpportunitySourceUnavailable } from '../errors.js';

/** One hit from a federal opportunity search, before its detail is fetched. */
export interface OpportunitySearchHit {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly agency: string;
}

export interface OpportunitySearchQuery {
  readonly keyword: string;
  /** How many hits to take from this search. The sweep is incremental, not exhaustive. */
  readonly limit: number;
}

/**
 * The federal opportunity feed. Two calls, because the search result does not carry
 * eligibility: `search2` returns the list, `fetchOpportunity` returns the applicant types,
 * the eligibility prose, the award figures, and the attachment metadata S4 needs.
 *
 * Screening cannot run on a search hit alone, which is why the sweep fetches detail for
 * everything it stores.
 */
export interface OpportunityGateway {
  search(
    query: OpportunitySearchQuery,
  ): Promise<Result<readonly OpportunitySearchHit[], OpportunitySourceUnavailable>>;

  fetchOpportunity(id: string): Promise<Result<FederalOpportunity, OpportunitySourceUnavailable>>;
}
