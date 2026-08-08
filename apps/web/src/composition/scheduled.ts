import 'server-only';
import {
  SendDeadlineWarnings,
  SendHighFitAlerts,
  SendWeeklyBriefing,
  SweepFederalOpportunities,
} from '@merit/application';
import {
  GoogleGmailGateway,
  GrantsGovOpportunityGateway,
  LibsqlMilestoneRepository,
  LibsqlNotificationRepository,
  LibsqlOpportunityRepository,
  LibsqlOrganizationRepository,
  UnavailableGmailGateway,
  createDatabase,
  loadConfig,
  systemClock,
  uuidIdGenerator,
} from '@merit/infrastructure';

/**
 * The scheduled half of the web composition root.
 *
 * These are the same use cases `apps/worker` runs from the command line. They are wired a second
 * time here rather than shared because a composition root is exactly the thing that may not be
 * shared across deployables -- the worker runs on a machine with a disk and no request timeout,
 * this one runs in a function with neither.
 */

/** Each job reports what it did, so the route can answer with something worth reading in a log. */
export type JobOutcome =
  | { readonly ok: true; readonly detail: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly reason: string;
    };

const wire = () => {
  const config = loadConfig();
  const db = createDatabase({ url: config.DATABASE_URL, authToken: config.DATABASE_AUTH_TOKEN });
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
    gmail,
    organizations: new LibsqlOrganizationRepository(db),
    notifications: new LibsqlNotificationRepository(db),
    milestones: new LibsqlMilestoneRepository(db),
  };
};

const dailySweep = async (): Promise<JobOutcome> => {
  const { config, db, organizations, notifications, gmail } = wire();

  const sweep = await new SweepFederalOpportunities(
    new GrantsGovOpportunityGateway({
      baseUrl: config.GRANTS_GOV_BASE_URL,
      timeoutMs: config.GRANTS_GOV_TIMEOUT_MS,
    }),
    new LibsqlOpportunityRepository(db),
    systemClock,
    uuidIdGenerator('sweep'),
  ).execute({
    keywords: config.FEDERAL_SWEEP_KEYWORDS,
    perKeyword: config.FEDERAL_SWEEP_PER_KEYWORD,
  });
  if (!sweep.ok) return { ok: false, reason: sweep.error.message };

  const all = await organizations.listAll();
  if (!all.ok) return { ok: false, reason: all.error.message };

  for (const organization of all.value) {
    const alerts = await new SendHighFitAlerts(
      new LibsqlOpportunityRepository(db),
      notifications,
      gmail,
    ).execute({ organization, recipients: config.SCHEDULED_ALERT_RECIPIENTS, boardLimit: 100 });
    if (!alerts.ok) return { ok: false, reason: alerts.error.message };
  }

  return {
    ok: true,
    detail: {
      organizations: all.value.length,
      searches: sweep.value.searchesRun,
      hits: sweep.value.hitsSeen,
    },
  };
};

const deadlineWatch = async (): Promise<JobOutcome> => {
  const { config, organizations, notifications, gmail, milestones } = wire();
  const all = await organizations.listAll();
  if (!all.ok) return { ok: false, reason: all.error.message };

  for (const organization of all.value) {
    const result = await new SendDeadlineWarnings(milestones, notifications, gmail, systemClock).execute({
      organizationId: organization.id as string,
      recipients: config.SCHEDULED_ALERT_RECIPIENTS,
      horizonDays: 7,
    });
    if (!result.ok) return { ok: false, reason: result.error.message };
  }
  return { ok: true, detail: { organizations: all.value.length } };
};

const weeklyBriefing = async (): Promise<JobOutcome> => {
  const { config, db, organizations, notifications, gmail } = wire();
  const all = await organizations.listAll();
  if (!all.ok) return { ok: false, reason: all.error.message };

  for (const organization of all.value) {
    const result = await new SendWeeklyBriefing(
      new LibsqlOpportunityRepository(db),
      notifications,
      gmail,
      systemClock,
    ).execute({
      organization,
      recipients: config.SCHEDULED_BRIEFING_RECIPIENTS,
      boardLimit: 100,
    });
    if (!result.ok) return { ok: false, reason: result.error.message };
  }
  return { ok: true, detail: { organizations: all.value.length } };
};

/** The only jobs the scheduler may trigger. An unknown name is a 404, not a dynamic import. */
export const SCHEDULED_JOBS: Record<string, () => Promise<JobOutcome>> = {
  'daily-sweep': dailySweep,
  'deadline-watch': deadlineWatch,
  'weekly-briefing': weeklyBriefing,
};
