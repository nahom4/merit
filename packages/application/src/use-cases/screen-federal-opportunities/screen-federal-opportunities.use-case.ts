import { ok, type Result } from '@merit/shared';
import {
  FitAssessment,
  mayReachAModel,
  screenEligibility,
  UsState,
  type CharityStatus,
  type EligibilityScreening,
  type FederalOpportunity,
  type Organization,
} from '@merit/domain';
import type { ModelGateway } from '../../ports/model.port.js';
import type {
  FitState,
  OpportunityRepository,
  StoredAssessment,
} from '../../ports/opportunity-repository.port.js';
import type { RegistryStatusReader } from '../../ports/registry-status.port.js';
import type { Clock } from '../../ports/clock.port.js';
import type { RepositoryUnavailable } from '../../errors.js';
import { fitScorePrompt, programAreaMenu } from './fit-score.prompt.js';

export interface ScreenFederalOpportunitiesInput {
  readonly organization: Organization;
  readonly limit?: number;
}

export interface ScreenedOpportunity {
  readonly opportunity: FederalOpportunity;
  readonly screening: EligibilityScreening;
  readonly fit: FitAssessment | null;
  readonly fitState: FitState;
  readonly fitStateReason: string | null;
}

export interface FederalBoard {
  readonly organization: Organization;
  readonly rows: readonly ScreenedOpportunity[];
  /**
   * Coverage, stated rather than implied. A board showing four opportunities out of ninety
   * screened must say so; silence would read as "there are four".
   */
  readonly coverage: {
    readonly opportunitiesConsidered: number;
    readonly eligible: number;
    readonly undecided: number;
    readonly screenedOut: number;
    readonly scored: number;
    readonly queued: number;
  };
}

/** 501(c)(3). The BMF states exempt status in this column. */
const CHARITY_SUBSECTION = 3;

/** How many opportunities the board may score in one page load. The rest are queued for the
 *  daily sweep: a click must not sit behind forty model calls, and the quota is shared. */
const INTERACTIVE_SCORE_BUDGET = 5;

const MAX_BOARD_ROWS = 200;

/**
 * S3: the cascade, in one place.
 *
 * Every opportunity is screened by rule -- no model, no network. Only what survives is scored,
 * and what is scored is scored once: an existing assessment made under the same screening is
 * served rather than re-bought. When the quota is spent the work is queued rather than failed,
 * so the board gets slower and thinner, never wrong.
 */
export class ScreenFederalOpportunities {
  constructor(
    private readonly repository: OpportunityRepository,
    private readonly registry: RegistryStatusReader,
    private readonly model: ModelGateway,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ScreenFederalOpportunitiesInput,
  ): Promise<Result<FederalBoard, RepositoryUnavailable>> {
    const { organization } = input;

    // Screening asks whether this organisation holds the status announcements require. Guessing
    // it from anything other than the registry would be inventing a field.
    const status = await this.registry.findStatus(organization.ein as string);
    if (!status.ok) return status;

    const charityStatus: CharityStatus = !status.value.isInRegistry
      ? 'unknown'
      : status.value.subsectionCode === CHARITY_SUBSECTION
        ? 'confirmed'
        : status.value.subsectionCode === null
          ? 'unknown'
          : 'not_held';

    const board = await this.repository.loadBoard(organization.id as string, input.limit ?? MAX_BOARD_ROWS);
    if (!board.ok) return board;

    const now = this.clock.now().toISOString();
    const rows: ScreenedOpportunity[] = [];
    const toPersist: StoredAssessment[] = [];
    let modelCallsLeft = INTERACTIVE_SCORE_BUDGET;

    for (const { opportunity, assessment } of board.value) {
      const screening = screenEligibility({
        opportunity,
        organizationName: organization.name,
        organizationState: UsState.toString(organization.state),
        charityStatus,
      });

      if (!mayReachAModel(screening)) {
        rows.push({ opportunity, screening, fit: null, fitState: 'not_applicable', fitStateReason: null });
        toPersist.push({
          organizationId: organization.id as string,
          opportunityId: opportunity.id,
          screening,
          fit: null,
          fitState: 'not_applicable',
          fitStateReason: null,
          assessedAt: now,
        });
        continue;
      }

      // Identical inputs never pay twice. The screening is part of what "identical" means:
      // a stored score justified against an eligibility picture that has since changed is a
      // stale judgement, not a saving.
      if (
        assessment !== null &&
        assessment.fit !== null &&
        assessment.fitState === 'scored' &&
        sameScreening(assessment.screening, screening)
      ) {
        rows.push({
          opportunity,
          screening,
          fit: assessment.fit,
          fitState: 'scored',
          fitStateReason: null,
        });
        continue;
      }

      if (modelCallsLeft === 0) {
        const reason =
          'Not scored yet: this page scores a few opportunities at a time, and the rest are ' +
          'queued for the next sweep.';
        rows.push({ opportunity, screening, fit: null, fitState: 'queued', fitStateReason: reason });
        toPersist.push({
          organizationId: organization.id as string,
          opportunityId: opportunity.id,
          screening,
          fit: null,
          fitState: 'queued',
          fitStateReason: reason,
          assessedAt: now,
        });
        continue;
      }

      modelCallsLeft -= 1;
      const menu = programAreaMenu(organization, opportunity);
      const contract = FitAssessment.responseContract(menu);

      const scored = await this.model.complete({
        purpose: 'fit_score',
        // A person is waiting on this screen. Batch work goes behind it, never in front.
        priority: 'interactive',
        prompt: fitScorePrompt(organization, opportunity, contract),
        responseContract: contract,
        parse: (raw) => FitAssessment.parse(raw, menu),
      });

      const row: ScreenedOpportunity = scored.ok
        ? { opportunity, screening, fit: scored.value.value, fitState: 'scored', fitStateReason: null }
        : {
            opportunity,
            screening,
            fit: null,
            fitState: 'queued',
            fitStateReason:
              scored.error.code === 'model_unavailable'
                ? `Not scored yet: ${scored.error.message}. The work is queued and nothing was lost.`
                : `Not scored: the model's answer did not satisfy the required shape (${scored.error.message}).`,
          };

      rows.push(row);
      toPersist.push({
        organizationId: organization.id as string,
        opportunityId: opportunity.id,
        screening,
        fit: row.fit,
        fitState: row.fitState,
        fitStateReason: row.fitStateReason,
        assessedAt: now,
      });
    }

    const saved = await this.repository.saveAssessments(toPersist);
    if (!saved.ok) return saved;

    return ok({
      organization,
      rows: [...rows].sort(byUsefulness),
      coverage: {
        opportunitiesConsidered: rows.length,
        eligible: rows.filter((row) => row.screening.outcome === 'eligible').length,
        undecided: rows.filter((row) => row.screening.outcome === 'indeterminate').length,
        screenedOut: rows.filter((row) => row.screening.outcome === 'ineligible').length,
        scored: rows.filter((row) => row.fitState === 'scored').length,
        queued: rows.filter((row) => row.fitState === 'queued').length,
      },
    });
  }
}

/** Two screenings agree when every rule reached the same verdict for the same reason. */
const sameScreening = (a: EligibilityScreening, b: EligibilityScreening): boolean =>
  a.outcome === b.outcome &&
  a.checks.length === b.checks.length &&
  a.checks.every((check, index) => check.code === b.checks[index]?.code);

/** Scored first, highest fit at the top; then what has not been scored yet; then what was
 *  screened out, which is kept on the board so the reason is visible rather than hidden. */
const RANK: Readonly<Record<FitState, number>> = { scored: 0, queued: 1, not_applicable: 2 };

const byUsefulness = (a: ScreenedOpportunity, b: ScreenedOpportunity): number => {
  if (RANK[a.fitState] !== RANK[b.fitState]) return RANK[a.fitState] - RANK[b.fitState];
  return (b.fit?.fitScore ?? 0) - (a.fit?.fitScore ?? 0);
};
