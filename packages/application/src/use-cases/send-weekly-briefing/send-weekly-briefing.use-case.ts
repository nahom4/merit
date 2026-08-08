import { ok, type Result } from '@merit/shared';
import type { Organization } from '@merit/domain';
import type { GmailGateway } from '../../ports/gmail-gateway.port.js';
import type { OpportunityRepository } from '../../ports/opportunity-repository.port.js';
import type { NotificationRepository } from '../../ports/notification-repository.port.js';
import type { Clock } from '../../ports/clock.port.js';
import type { RepositoryUnavailable, GmailUnavailable } from '../../errors.js';
import { HIGH_FIT_THRESHOLD } from '@merit/domain';

export interface SendWeeklyBriefingInput {
  readonly organization: Organization;
  readonly recipients: readonly string[];
  readonly boardLimit: number;
}

export interface WeeklyBriefingSummary {
  readonly highFitCount: number;
  readonly queuedCount: number;
  readonly briefingSent: boolean;
}

export class SendWeeklyBriefing {
  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly notifications: NotificationRepository,
    private readonly gmail: GmailGateway,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: SendWeeklyBriefingInput,
  ): Promise<Result<WeeklyBriefingSummary, RepositoryUnavailable | GmailUnavailable>> {
    const board = await this.opportunities.loadBoard(input.organization.id as string, input.boardLimit);
    if (!board.ok) return board;

    const highFitCount = board.value.filter(
      (row) =>
        row.assessment?.fitState === 'scored' && (row.assessment.fit?.fitScore ?? 0) >= HIGH_FIT_THRESHOLD,
    ).length;
    const queuedCount = board.value.filter((row) => row.assessment?.fitState === 'queued').length;
    const weekStart = this.clock.now().toISOString().slice(0, 10);

    const reserved = await this.notifications.reserveNotification({
      dedupeKey: `weekly-briefing:${input.organization.id}:${weekStart}`,
      kind: 'weekly_briefing',
      organizationId: input.organization.id as string,
      opportunityId: null,
      subject: `Weekly briefing: ${input.organization.name}`,
      body: `High-fit opportunities: ${highFitCount}\nQueued opportunities: ${queuedCount}`,
    });
    if (!reserved.ok) return reserved;
    if (!reserved.value) return ok({ highFitCount, queuedCount, briefingSent: false });

    const sent = await this.gmail.sendMessage({
      recipients: input.recipients,
      subject: `Weekly briefing: ${input.organization.name}`,
      body: `High-fit opportunities: ${highFitCount}\nQueued opportunities: ${queuedCount}`,
    });
    if (!sent.ok) return sent;

    return ok({ highFitCount, queuedCount, briefingSent: true });
  }
}
