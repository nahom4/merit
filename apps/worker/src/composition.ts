import { consoleLogger } from '@merit/shared';
import {
  createDatabase,
  loadConfig,
  LibsqlGrantRepository,
  LibsqlMilestoneRepository,
  LibsqlNotificationRepository,
  LibsqlOrganizationRepository,
  GoogleCalendarGateway,
  GoogleGmailGateway,
  UnavailableCalendarGateway,
  UnavailableGmailGateway,
  migrate,
} from '@merit/infrastructure';

/** The worker's composition root. Adapters are constructed here and nowhere else. */
export const wire = async () => {
  const config = loadConfig();
  const db = createDatabase({ url: config.DATABASE_URL, authToken: config.DATABASE_AUTH_TOKEN });
  await migrate(db);
  const calendar =
    config.GOOGLE_OAUTH_ACCESS_TOKEN === undefined
      ? new UnavailableCalendarGateway('Google Calendar is not configured')
      : new GoogleCalendarGateway({
          baseUrl: config.GOOGLE_CALENDAR_BASE_URL,
          calendarId: config.GOOGLE_CALENDAR_ID,
          accessToken: config.GOOGLE_OAUTH_ACCESS_TOKEN,
          timeoutMs: config.HTTP_TIMEOUT_MS,
        });
  const gmail =
    config.GOOGLE_OAUTH_ACCESS_TOKEN === undefined
      ? new UnavailableGmailGateway('Gmail is not configured')
      : new GoogleGmailGateway({
          baseUrl: config.GOOGLE_GMAIL_BASE_URL,
          userId: config.GOOGLE_GMAIL_USER_ID,
          accessToken: config.GOOGLE_OAUTH_ACCESS_TOKEN,
          timeoutMs: config.HTTP_TIMEOUT_MS,
        });
  return {
    config,
    db,
    logger: consoleLogger,
    grants: new LibsqlGrantRepository(db),
    organizations: new LibsqlOrganizationRepository(db),
    notifications: new LibsqlNotificationRepository(db),
    milestones: new LibsqlMilestoneRepository(db),
    calendar,
    gmail,
  };
};
