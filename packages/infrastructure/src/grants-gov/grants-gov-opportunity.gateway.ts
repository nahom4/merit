import { err, ok, type Result } from '@merit/shared';
import type { FederalOpportunity } from '@merit/domain';
import { OpportunitySourceUnavailable } from '@merit/application';
import type { OpportunityGateway, OpportunitySearchHit, OpportunitySearchQuery } from '@merit/application';
import { GrantsGovOpportunitySchema, GrantsGovSearchResponseSchema } from './opportunity.schema.js';
import { toFederalOpportunity } from './opportunity-mapper.js';

export interface GrantsGovGatewayOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Retries after the first attempt. Zero in tests that assert a single call. */
  readonly retries?: number;
  /** Which statuses to sweep. Posted work is the only work a user can act on today. */
  readonly statuses?: string;
}

/**
 * Grants.gov: free, keyless, and the source of every federal opportunity Merit screens.
 *
 * Two calls, because the search result does not carry eligibility. `search2` returns the list
 * with the federal program number on it; `fetchOpportunity` returns the applicant type codes,
 * the eligibility prose, the award figures, and the attachment metadata S4 needs. Screening
 * cannot run on a search hit alone, which is why the sweep pays for the second call.
 */
export class GrantsGovOpportunityGateway implements OpportunityGateway {
  constructor(private readonly options: GrantsGovGatewayOptions) {}

  async search(
    query: OpportunitySearchQuery,
  ): Promise<Result<readonly OpportunitySearchHit[], OpportunitySourceUnavailable>> {
    const response = await this.post('search2', {
      keyword: query.keyword,
      oppStatuses: this.options.statuses ?? 'posted',
      rows: query.limit,
    });
    if (!response.ok) return response;

    const parsed = GrantsGovSearchResponseSchema.safeParse(response.value);
    if (!parsed.success) {
      return err(
        new OpportunitySourceUnavailable('Grants.gov search payload did not match the expected schema', {
          source: 'grants_gov',
          call: 'search2',
          keyword: query.keyword,
          issue: parsed.error.issues[0]?.message ?? 'unknown',
        }),
      );
    }

    return ok(
      parsed.data.data.oppHits.map((hit) => ({
        id: hit.id,
        number: hit.number,
        title: hit.title,
        agency: hit.agency ?? 'Agency not stated',
      })),
    );
  }

  async fetchOpportunity(id: string): Promise<Result<FederalOpportunity, OpportunitySourceUnavailable>> {
    const response = await this.post('fetchOpportunity', { opportunityId: id });
    if (!response.ok) return response;

    const parsed = GrantsGovOpportunitySchema.safeParse(response.value);
    if (!parsed.success) {
      return err(
        new OpportunitySourceUnavailable('Grants.gov detail payload did not match the expected schema', {
          source: 'grants_gov',
          call: 'fetchOpportunity',
          opportunityId: id,
          issue: parsed.error.issues[0]?.message ?? 'unknown',
        }),
      );
    }

    const opportunity = toFederalOpportunity(parsed.data);
    if (!opportunity.ok) {
      // A field we cannot read is a fault the sweep counts, never a value it invents.
      return err(
        new OpportunitySourceUnavailable(opportunity.error.message, {
          source: 'grants_gov',
          call: 'fetchOpportunity',
          opportunityId: id,
          ...opportunity.error.context,
        }),
      );
    }

    return ok(opportunity.value);
  }

  private async post(
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Result<unknown, OpportunitySourceUnavailable>> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/${path}`;
    const attempts = (this.options.retries ?? 2) + 1;

    let lastFailure = new OpportunitySourceUnavailable('no attempt was made', {
      source: 'grants_gov',
      call: path,
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await this.attempt(url, path, body);
      if (result.ok) return result;
      lastFailure = result.error;

      // Only transport and 5xx are worth asking again: a 400 means we sent the wrong request,
      // and the second one would be just as wrong.
      if (result.error.context['retryable'] !== true) return result;
      if (attempt < attempts) await backoff(attempt);
    }

    return err(lastFailure);
  }

  private async attempt(
    url: string,
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Result<unknown, OpportunitySourceUnavailable>> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return err(
          new OpportunitySourceUnavailable(`Grants.gov returned ${response.status}`, {
            source: 'grants_gov',
            call: path,
            status: response.status,
            retryable: response.status >= 500,
          }),
        );
      }

      return ok(await response.json());
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      return err(
        new OpportunitySourceUnavailable(
          aborted ? 'Grants.gov did not respond in time' : 'Grants.gov could not be reached',
          {
            source: 'grants_gov',
            call: path,
            cause: cause instanceof Error ? cause.message : String(cause),
            retryable: true,
          },
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Exponential backoff with jitter. Randomness lives in an adapter, which is where the rule
 *  puts it -- tests asserting call counts set `retries: 0` rather than waiting on it. */
const backoff = (attempt: number): Promise<void> => {
  const base = 200 * 2 ** (attempt - 1);
  return new Promise((resolve) => setTimeout(resolve, base + Math.random() * base));
};
