import { err, ok, type Result } from '@merit/shared';
import { CalendarUnavailable } from '@merit/application';
import type { CalendarEvent, CalendarEventInput, CalendarGateway } from '@merit/application';

export interface GoogleCalendarGatewayOptions {
  readonly baseUrl: string;
  readonly calendarId: string;
  readonly accessToken?: string;
  readonly timeoutMs: number;
}

export class GoogleCalendarGateway implements CalendarGateway {
  constructor(private readonly options: GoogleCalendarGatewayOptions) {}

  async upsertEvent(input: CalendarEventInput): Promise<Result<CalendarEvent, CalendarUnavailable>> {
    if (this.options.accessToken === undefined) {
      return err(new CalendarUnavailable('Google Calendar is not configured', { operation: 'upsertEvent' }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.baseUrl}/calendars/${this.options.calendarId}/events`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: input.summary,
          description: input.description,
          start: { date: input.startDate, timeZone: input.timeZone },
          end: { date: input.endDate, timeZone: input.timeZone },
          extendedProperties: { private: { merit_dedupe_key: input.idempotencyKey } },
          transparency: 'transparent',
        }),
      });

      if (!response.ok) {
        return err(
          new CalendarUnavailable(`Google Calendar returned ${response.status}`, {
            operation: 'upsertEvent',
            status: response.status,
          }),
        );
      }

      const raw = (await response.json()) as { id?: unknown; htmlLink?: unknown };
      return ok({
        id: typeof raw.id === 'string' ? raw.id : input.idempotencyKey,
        htmlLink: typeof raw.htmlLink === 'string' ? raw.htmlLink : null,
      });
    } catch (cause) {
      return err(
        new CalendarUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'upsertEvent',
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
