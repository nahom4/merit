import { err, ok, type Result } from '@merit/shared';
import type { FederalOpportunity } from '@merit/domain';
import type {
  BoardRow,
  OpportunityRepository,
  StoredAssessment,
  SweepRun,
} from '../ports/opportunity-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

/**
 * A hand-written fake, not a mock. It keeps the two properties the SQL has and a unit test
 * depends on: upsert is keyed on the opportunity id, and an assessment belongs to one
 * (organisation, opportunity) pair.
 */
export class InMemoryOpportunityRepository implements OpportunityRepository {
  private readonly opportunities = new Map<string, FederalOpportunity>();
  private readonly assessments = new Map<string, StoredAssessment>();
  private sweep: SweepRun | null = null;
  private failsOnce = false;

  constructor(seed: readonly FederalOpportunity[] = []) {
    for (const opportunity of seed) this.opportunities.set(opportunity.id, opportunity);
  }

  failNextQuery(): void {
    this.failsOnce = true;
  }

  /** What was written, so a test can assert persistence rather than trusting a return value. */
  storedAssessments(): readonly StoredAssessment[] {
    return [...this.assessments.values()];
  }

  private guard<T>(operation: string): Result<T, RepositoryUnavailable> | null {
    if (!this.failsOnce) return null;
    this.failsOnce = false;
    return err(new RepositoryUnavailable('opportunity query failed', { operation, table: 'opportunities' }));
  }

  async upsertOpportunities(
    opportunities: readonly FederalOpportunity[],
  ): Promise<Result<{ inserted: number; updated: number }, RepositoryUnavailable>> {
    const failure = this.guard<{ inserted: number; updated: number }>('upsertOpportunities');
    if (failure !== null) return failure;

    let inserted = 0;
    let updated = 0;
    for (const opportunity of opportunities) {
      if (this.opportunities.has(opportunity.id)) updated += 1;
      else inserted += 1;
      this.opportunities.set(opportunity.id, opportunity);
    }
    return ok({ inserted, updated });
  }

  async listOpportunities(
    limit: number,
  ): Promise<Result<readonly FederalOpportunity[], RepositoryUnavailable>> {
    const failure = this.guard<readonly FederalOpportunity[]>('listOpportunities');
    if (failure !== null) return failure;
    return ok([...this.opportunities.values()].slice(0, limit));
  }

  async findOpportunity(id: string): Promise<Result<FederalOpportunity | null, RepositoryUnavailable>> {
    const failure = this.guard<FederalOpportunity | null>('findOpportunity');
    if (failure !== null) return failure;
    return ok(this.opportunities.get(id) ?? null);
  }

  async saveAssessments(
    assessments: readonly StoredAssessment[],
  ): Promise<Result<number, RepositoryUnavailable>> {
    const failure = this.guard<number>('saveAssessments');
    if (failure !== null) return failure;

    for (const assessment of assessments) {
      this.assessments.set(`${assessment.organizationId}:${assessment.opportunityId}`, assessment);
    }
    return ok(assessments.length);
  }

  async loadBoard(
    organizationId: string,
    limit: number,
  ): Promise<Result<readonly BoardRow[], RepositoryUnavailable>> {
    const failure = this.guard<readonly BoardRow[]>('loadBoard');
    if (failure !== null) return failure;

    return ok(
      [...this.opportunities.values()].slice(0, limit).map((opportunity) => ({
        opportunity,
        assessment: this.assessments.get(`${organizationId}:${opportunity.id}`) ?? null,
      })),
    );
  }

  async recordSweep(run: SweepRun): Promise<Result<void, RepositoryUnavailable>> {
    const failure = this.guard<void>('recordSweep');
    if (failure !== null) return failure;
    this.sweep = run;
    return ok(undefined);
  }

  async latestSweep(): Promise<Result<SweepRun | null, RepositoryUnavailable>> {
    const failure = this.guard<SweepRun | null>('latestSweep');
    if (failure !== null) return failure;
    return ok(this.sweep);
  }
}
