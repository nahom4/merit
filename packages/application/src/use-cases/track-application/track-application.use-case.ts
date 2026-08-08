import { ok, type Result } from '@merit/shared';
import type { CalendarGateway } from '../../ports/calendar-gateway.port.js';
import type { OutreachRepository } from '../../ports/outreach-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';

export interface TrackApplicationInput {
  readonly organizationId: string;
  readonly opportunityId: string;
  readonly opportunityNumber: string;
  readonly title: string;
  /** The announcement's close date, ISO yyyy-mm-dd. Null when the announcement states none. */
  readonly closeDate: string | null;
  readonly studioHref: string;
  readonly stage: 'started' | 'submitted';
}

export interface TrackApplicationOutput {
  readonly remindersScheduled: number;
  readonly deadlineReminderSkipped: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A federal application, tracked on the same shelf as foundation outreach.
 *
 * `started` puts two reminders on the calendar. `submitted` is a fact only the user can report
 * — Merit never submits — so the second button is how they report it. Both are stored as
 * outreach rows of kind `federal`, because a development director's pursuits are one list.
 */
export class TrackApplication {
  constructor(
    private readonly outreaches: OutreachRepository,
    private readonly calendar: CalendarGateway | null = null,
    private readonly calendarId: string = 'primary',
  ) {}

  async execute(
    input: TrackApplicationInput,
  ): Promise<Result<TrackApplicationOutput, RepositoryUnavailable>> {
    const existing = await this.outreaches.findOutreach(input.organizationId, input.opportunityId, 'federal');
    if (!existing.ok) return existing;

    const alreadyScheduled = existing.value?.followUpsScheduledAt ?? null;
    const scheduling =
      input.stage === 'started' && alreadyScheduled === null
        ? await this.scheduleReminders(input)
        : { scheduledAt: alreadyScheduled, count: 0, deadlineSkipped: input.closeDate === null };

    const saved = await this.outreaches.upsertOutreach({
      organizationId: input.organizationId,
      targetId: input.opportunityId,
      targetKind: 'federal',
      targetName: `${input.opportunityNumber} · ${input.title}`,
      contactEmail: null,
      subject:
        input.closeDate === null ? 'Federal application' : `Federal application, closes ${input.closeDate}`,
      body: input.studioHref,
      // The outreach vocabulary reused rather than widened: a started application is a draft,
      // a submitted one has gone out.
      status: input.stage === 'submitted' ? 'sent' : 'draft',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: input.stage === 'submitted' ? new Date().toISOString() : null,
      followUpsScheduledAt: scheduling.scheduledAt,
    });
    if (!saved.ok) return saved;

    return ok({
      remindersScheduled: scheduling.count,
      deadlineReminderSkipped: scheduling.deadlineSkipped,
    });
  }

  /**
   * One reminder three days from now, to make a start, and one five days before the deadline,
   * to finish. An announcement with no close date on file gets the first and says so, rather
   * than having a deadline invented for it.
   */
  private async scheduleReminders(
    input: TrackApplicationInput,
  ): Promise<{ scheduledAt: string | null; count: number; deadlineSkipped: boolean }> {
    if (this.calendar === null) {
      return { scheduledAt: null, count: 0, deadlineSkipped: input.closeDate === null };
    }

    const now = new Date();
    const close = input.closeDate === null ? null : Date.parse(`${input.closeDate}T00:00:00.000Z`);
    const deadlineDay = close === null || Number.isNaN(close) ? null : new Date(close - 5 * DAY_MS);

    const planned = [
      {
        when: new Date(now.getTime() + 3 * DAY_MS),
        summary: `Work on: ${input.title}`,
        why: 'Three days since you started this application.',
      },
      ...(deadlineDay === null || deadlineDay.getTime() <= now.getTime()
        ? []
        : [
            {
              when: deadlineDay,
              summary: `Five days to deadline: ${input.title}`,
              why: `${input.opportunityNumber} closes on ${input.closeDate ?? 'an unstated date'}.`,
            },
          ]),
    ];

    let count = 0;
    for (const event of planned) {
      const startDate = event.when.toISOString().slice(0, 10);
      const written = await this.calendar.upsertEvent({
        calendarId: this.calendarId,
        idempotencyKey: `application:${input.organizationId}:${input.opportunityId}:${startDate}`,
        summary: event.summary,
        description:
          `${event.why}\n\n` +
          `Open the draft studio: ${input.studioHref}\n\n` +
          'Merit never submits an application. This is a reminder for you to.',
        startDate,
        endDate: new Date(event.when.getTime() + DAY_MS).toISOString().slice(0, 10),
        timeZone: 'UTC',
      });
      // A calendar that is down loses a reminder, not the record that work has begun.
      if (!written.ok) return { scheduledAt: null, count: 0, deadlineSkipped: true };
      count += 1;
    }

    return { scheduledAt: new Date().toISOString(), count, deadlineSkipped: deadlineDay === null };
  }
}
