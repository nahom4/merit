import { err, type Result } from '@merit/shared';
import { CalendarUnavailable, GmailUnavailable } from '@merit/application';
import type { CalendarEvent, CalendarEventInput, CalendarGateway } from '@merit/application';
import type { GmailGateway, GmailMessage, GmailMessageInput } from '@merit/application';

export class UnavailableCalendarGateway implements CalendarGateway {
  constructor(private readonly reason: string) {}

  async upsertEvent(_input: CalendarEventInput): Promise<Result<CalendarEvent, CalendarUnavailable>> {
    return err(new CalendarUnavailable(this.reason, { operation: 'upsertEvent' }));
  }
}

export class UnavailableGmailGateway implements GmailGateway {
  constructor(private readonly reason: string) {}

  async sendMessage(_input: GmailMessageInput): Promise<Result<GmailMessage, GmailUnavailable>> {
    return err(new GmailUnavailable(this.reason, { operation: 'sendMessage' }));
  }
}
