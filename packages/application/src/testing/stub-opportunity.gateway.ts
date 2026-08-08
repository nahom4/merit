import { err, ok, type Result } from '@merit/shared';
import type { FederalOpportunity } from '@merit/domain';
import { OpportunitySourceUnavailable } from '../errors.js';
import type {
  OpportunityGateway,
  OpportunitySearchHit,
  OpportunitySearchQuery,
} from '../ports/opportunity-gateway.port.js';

/**
 * A federal feed a test can state exactly: which keyword returns which hits, and which
 * opportunity ids fail to fetch. Detail failures are the interesting case -- a sweep must
 * count them and carry on rather than losing the whole run to one bad announcement.
 */
export class StubOpportunityGateway implements OpportunityGateway {
  readonly searched: string[] = [];
  readonly fetched: string[] = [];

  constructor(
    private readonly hitsByKeyword: Readonly<Record<string, readonly OpportunitySearchHit[]>>,
    private readonly details: Readonly<Record<string, FederalOpportunity>>,
    private readonly failing: {
      readonly searches?: readonly string[];
      readonly fetches?: readonly string[];
    } = {},
  ) {}

  async search(
    query: OpportunitySearchQuery,
  ): Promise<Result<readonly OpportunitySearchHit[], OpportunitySourceUnavailable>> {
    this.searched.push(query.keyword);
    if (this.failing.searches?.includes(query.keyword) === true) {
      return err(
        new OpportunitySourceUnavailable('search failed', { keyword: query.keyword, source: 'stub' }),
      );
    }
    return ok((this.hitsByKeyword[query.keyword] ?? []).slice(0, query.limit));
  }

  async fetchOpportunity(id: string): Promise<Result<FederalOpportunity, OpportunitySourceUnavailable>> {
    this.fetched.push(id);
    if (this.failing.fetches?.includes(id) === true) {
      return err(new OpportunitySourceUnavailable('detail failed', { id, source: 'stub' }));
    }
    const detail = this.details[id];
    if (detail === undefined) {
      return err(new OpportunitySourceUnavailable('no such opportunity', { id, source: 'stub' }));
    }
    return ok(detail);
  }
}
