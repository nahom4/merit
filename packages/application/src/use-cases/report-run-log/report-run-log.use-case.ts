import { ok, type Result } from '@merit/shared';
import type { ModelCallLog, ModelSpend } from '../../ports/model-telemetry.port.js';
import type { OpportunityRepository, SweepRun } from '../../ports/opportunity-repository.port.js';
import type { Clock } from '../../ports/clock.port.js';
import type { RepositoryUnavailable } from '../../errors.js';

export interface RunLog {
  /** Null when no sweep has run yet -- which is a different fact from a sweep that found nothing. */
  readonly sweep: SweepRun | null;
  readonly spend: ModelSpend;
  readonly since: string;
}

export interface ReportRunLogInput {
  readonly windowHours: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The system reporting its own health as data rather than asking to be trusted -- the same
 * instinct as the ingestion reconciliation check and the coverage line on every use case.
 *
 * Without these numbers, "the sweep ran" and "the sweep ran and silently degraded on quota
 * exhaustion" look identical from the outside.
 */
export class ReportRunLog {
  constructor(
    private readonly repository: OpportunityRepository,
    private readonly modelCalls: ModelCallLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: ReportRunLogInput): Promise<Result<RunLog, RepositoryUnavailable>> {
    const sweep = await this.repository.latestSweep();
    if (!sweep.ok) return sweep;

    const since = new Date(this.clock.now().getTime() - input.windowHours * HOUR_MS).toISOString();
    const spend = await this.modelCalls.spendSince(since);
    if (!spend.ok) return spend;

    return ok({ sweep: sweep.value, spend: spend.value, since });
  }
}
