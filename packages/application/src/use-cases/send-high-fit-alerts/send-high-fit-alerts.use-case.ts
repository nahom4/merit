import { ok, type Result } from '@merit/shared';
import type { BoardRow, OpportunityRepository } from '../../ports/opportunity-repository.port.js';
import type { NotificationRepository } from '../../ports/notification-repository.port.js';
import type { GmailGateway } from '../../ports/gmail-gateway.port.js';
import type { Organization } from '@merit/domain';
import type { RepositoryUnavailable, GmailUnavailable } from '../../errors.js';
import { HIGH_FIT_THRESHOLD } from '@merit/domain';

export interface SendHighFitAlertsInput {
  readonly organization: Organization;
  readonly recipients: readonly string[];
  readonly threshold?: number;
  readonly boardLimit: number;
}

export interface HighFitAlertSummary {
  readonly opportunitiesSeen: number;
  readonly alertsSent: number;
  readonly alertsSuppressed: number;
}

export class SendHighFitAlerts {
  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly notifications: NotificationRepository,
    private readonly gmail: GmailGateway,
  ) {}

  async execute(
    input: SendHighFitAlertsInput,
  ): Promise<Result<HighFitAlertSummary, RepositoryUnavailable | GmailUnavailable>> {
    const board = await this.opportunities.loadBoard(input.organization.id as string, input.boardLimit);
    if (!board.ok) return board;

    const threshold = input.threshold ?? HIGH_FIT_THRESHOLD;
    let alertsSent = 0;
    let alertsSuppressed = 0;

    for (const row of board.value) {
      if (!this.isAlertable(row, threshold)) continue;

      const dedupeKey = `high-fit:${input.organization.id}:${row.opportunity.id}`;
      const reserved = await this.notifications.reserveNotification({
        dedupeKey,
        kind: 'high_fit_alert',
        organizationId: input.organization.id as string,
        opportunityId: row.opportunity.id,
        subject: `High-fit opportunity: ${row.opportunity.number}`,
        body: [
          `${row.opportunity.title}`,
          `Fit score: ${row.assessment?.fit?.fitScore ?? 'not scored yet'}/100`,
          `Rationale: ${row.assessment?.fit?.rationale ?? 'no fit rationale stored'}`,
        ].join('\n'),
      });
      if (!reserved.ok) return reserved;
      if (!reserved.value) {
        alertsSuppressed += 1;
        continue;
      }

      const sent = await this.gmail.sendMessage({
        recipients: input.recipients,
        subject: `High-fit opportunity: ${row.opportunity.number}`,
        body: `${input.organization.name}\n\n${row.opportunity.title}\n\n${row.opportunity.closeDate ?? 'No deadline stated'}`,
      });
      if (!sent.ok) return sent;
      alertsSent += 1;
    }

    return ok({
      opportunitiesSeen: board.value.length,
      alertsSent,
      alertsSuppressed,
    });
  }

  private isAlertable(row: BoardRow, threshold: number): boolean {
    return row.assessment?.fitState === 'scored' && (row.assessment.fit?.fitScore ?? 0) >= threshold;
  }
}
