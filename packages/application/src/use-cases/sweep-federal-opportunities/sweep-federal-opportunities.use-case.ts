import { err, ok, type Result } from '@merit/shared';
import type { FederalOpportunity } from '@merit/domain';
import type { OpportunityGateway } from '../../ports/opportunity-gateway.port.js';
import type { OpportunityRepository, SweepRun } from '../../ports/opportunity-repository.port.js';
import type { Clock } from '../../ports/clock.port.js';
import type { IdGenerator } from '../../ports/id-generator.port.js';
import { OpportunitySourceUnavailable, type RepositoryUnavailable } from '../../errors.js';

export interface SweepInput {
  /** What to search for. In production these come from the organisation's program area. */
  readonly keywords: readonly string[];
  readonly perKeyword: number;
}

export type SweepError = OpportunitySourceUnavailable | RepositoryUnavailable;

/**
 * S3: bring the posted federal opportunities into the graph.
 *
 * Deduplicated on the Grants.gov opportunity id, on both axes: within a run, because two
 * keywords routinely return the same announcement and its detail costs a second HTTP call;
 * and across runs, because the daily sweep re-reads most of what it read yesterday. Neither is
 * an optimisation -- an announcement stored twice would be screened twice and scored twice,
 * and the second score would spend quota to say what the first one said.
 *
 * A hit whose detail cannot be read is counted as a parse fault and the sweep carries on. A
 * feed that cannot be read at all is an error: reporting "0 opportunities" for an outage would
 * be indistinguishable from a quiet week, and the difference matters.
 */
export class SweepFederalOpportunities {
  constructor(
    private readonly gateway: OpportunityGateway,
    private readonly repository: OpportunityRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: SweepInput): Promise<Result<SweepRun, SweepError>> {
    const startedAt = this.clock.now().toISOString();

    const seen = new Map<string, FederalOpportunity>();
    const attempted = new Set<string>();
    let hitsSeen = 0;
    let parseFaults = 0;
    let searchesFailed = 0;

    for (const keyword of input.keywords) {
      const hits = await this.gateway.search({ keyword, limit: input.perKeyword });
      if (!hits.ok) {
        searchesFailed += 1;
        parseFaults += 1;
        continue;
      }

      for (const hit of hits.value) {
        hitsSeen += 1;
        if (attempted.has(hit.id)) continue;
        attempted.add(hit.id);

        const detail = await this.gateway.fetchOpportunity(hit.id);
        if (!detail.ok) {
          parseFaults += 1;
          continue;
        }
        seen.set(detail.value.id, detail.value);
      }
    }

    if (searchesFailed === input.keywords.length && input.keywords.length > 0) {
      return err(
        new OpportunitySourceUnavailable('no federal opportunity search succeeded', {
          searches: input.keywords.length,
        }),
      );
    }

    const written = await this.repository.upsertOpportunities([...seen.values()]);
    if (!written.ok) return written;

    const run: SweepRun = {
      id: this.ids.next(),
      startedAt,
      finishedAt: this.clock.now().toISOString(),
      searchesRun: input.keywords.length - searchesFailed,
      hitsSeen,
      opportunitiesInserted: written.value.inserted,
      opportunitiesUpdated: written.value.updated,
      parseFaults,
    };

    const recorded = await this.repository.recordSweep(run);
    if (!recorded.ok) return recorded;

    return ok(run);
  }
}
