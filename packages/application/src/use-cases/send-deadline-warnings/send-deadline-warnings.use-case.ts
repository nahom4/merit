import { ok, type Result } from '@merit/shared';
import type { GmailGateway } from '../../ports/gmail-gateway.port.js';
import type { MilestoneRepository } from '../../ports/milestone-repository.port.js';
import type { NotificationRepository } from '../../ports/notification-repository.port.js';
import type { Clock } from '../../ports/clock.port.js';
import type { RepositoryUnavailable, GmailUnavailable } from '../../errors.js';

export interface SendDeadlineWarningsInput {
  readonly organizationId: string;
  readonly recipients: readonly string[];
  readonly horizonDays: number;
}

export interface DeadlineWarningSummary {
  readonly milestonesSeen: number;
  readonly warningsSent: number;
  readonly warningsSuppressed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class SendDeadlineWarnings {
  constructor(
    private readonly milestones: MilestoneRepository,
    private readonly notifications: NotificationRepository,
    private readonly gmail: GmailGateway,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: SendDeadlineWarningsInput,
  ): Promise<Result<DeadlineWarningSummary, RepositoryUnavailable | GmailUnavailable>> {
    const dueBefore = new Date(this.clock.now().getTime() + input.horizonDays * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const due = await this.milestones.listDueMilestones(input.organizationId, dueBefore);
    if (!due.ok) return due;

    let warningsSent = 0;
    let warningsSuppressed = 0;
    for (const milestone of due.value) {
      const reserved = await this.notifications.reserveNotification({
        dedupeKey: `deadline-warning:${milestone.dedupeKey}`,
        kind: 'at_risk_warning',
        organizationId: input.organizationId,
        opportunityId: milestone.opportunityId,
        subject: `At-risk milestone: ${milestone.label}`,
        body: `${milestone.label} is due ${milestone.dueDate}`,
      });
      if (!reserved.ok) return reserved;
      if (!reserved.value) {
        warningsSuppressed += 1;
        continue;
      }

      const sent = await this.gmail.sendMessage({
        recipients: input.recipients,
        subject: `At-risk milestone: ${milestone.label}`,
        body: `${milestone.label} for ${milestone.opportunityId} is due ${milestone.dueDate}`,
      });
      if (!sent.ok) return sent;
      warningsSent += 1;
    }

    return ok({ milestonesSeen: due.value.length, warningsSent, warningsSuppressed });
  }
}
