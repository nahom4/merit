import { err, ok, type Result } from '@merit/shared';
import { CalendarUnavailable } from '../errors.js';
import type { CalendarEvent, CalendarEventInput, CalendarGateway } from '../ports/calendar-gateway.port.js';

export class StubCalendarGateway implements CalendarGateway {
  readonly events: CalendarEventInput[] = [];
  constructor(private readonly failOnSend = false) {}

  async upsertEvent(input: CalendarEventInput): Promise<Result<CalendarEvent, CalendarUnavailable>> {
    this.events.push(input);
    if (this.failOnSend) {
      return err(new CalendarUnavailable('calendar write failed', { operation: 'upsertEvent' }));
    }
    return ok({ id: `event_${this.events.length}`, htmlLink: null });
  }
}
