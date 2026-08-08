import type { Result } from '@merit/shared';
import type { CalendarUnavailable } from '../errors.js';

export interface CalendarEventInput {
  readonly calendarId: string;
  readonly idempotencyKey: string;
  readonly summary: string;
  readonly description: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly timeZone: string;
}

export interface CalendarEvent {
  readonly id: string;
  readonly htmlLink: string | null;
}

export interface CalendarGateway {
  upsertEvent(input: CalendarEventInput): Promise<Result<CalendarEvent, CalendarUnavailable>>;
}
