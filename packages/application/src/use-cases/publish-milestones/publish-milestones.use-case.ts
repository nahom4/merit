import { ok, type Result } from '@merit/shared';
import { buildMilestones, type FederalOpportunity, type PlannedMilestone } from '@merit/domain';
import type { CalendarGateway } from '../../ports/calendar-gateway.port.js';
import type { MilestoneRepository } from '../../ports/milestone-repository.port.js';
import type { Clock } from '../../ports/clock.port.js';
import type { CalendarUnavailable, RepositoryUnavailable } from '../../errors.js';

export interface PublishMilestonesInput {
  readonly organizationId: string;
  readonly opportunity: FederalOpportunity;
  readonly approved: boolean;
  readonly calendarId: string;
  readonly timeZone: string;
}

export interface PublishedMilestones {
  readonly planned: readonly PlannedMilestone[];
  readonly committed: number;
}

export class PublishMilestones {
  constructor(
    private readonly milestones: MilestoneRepository,
    private readonly calendar: CalendarGateway,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: PublishMilestonesInput,
  ): Promise<Result<PublishedMilestones, RepositoryUnavailable | CalendarUnavailable>> {
    if (input.opportunity.closeDate === null) {
      return ok({ planned: [], committed: 0 });
    }

    const planned = buildMilestones(input.opportunity.closeDate, this.clock.now().toISOString().slice(0, 10));
    if (!input.approved) {
      return ok({ planned, committed: 0 });
    }

    let committedCount = 0;
    for (const milestone of planned) {
      const event = await this.calendar.upsertEvent({
        calendarId: input.calendarId,
        idempotencyKey: `milestone:${input.organizationId}:${input.opportunity.id}:${milestone.kind}:${milestone.dueDate}`,
        summary: `${input.opportunity.number}: ${milestone.label}`,
        description: input.opportunity.title,
        startDate: milestone.dueDate,
        endDate: milestone.dueDate,
        timeZone: input.timeZone,
      });
      if (!event.ok) return event;

      const committed = await this.milestones.upsertMilestones([
        {
          dedupeKey: `milestone:${input.organizationId}:${input.opportunity.id}:${milestone.kind}:${milestone.dueDate}`,
          organizationId: input.organizationId,
          opportunityId: input.opportunity.id,
          kind: milestone.kind,
          label: milestone.label,
          dueDate: milestone.dueDate,
          calendarEventId: event.value.id,
          approvedAt: this.clock.now().toISOString(),
        },
      ]);
      if (!committed.ok) return committed;
      committedCount += committed.value;
    }

    return ok({ planned, committed: committedCount });
  }
}
