import { SendHighFitAlerts, SweepFederalOpportunities } from '@merit/application';
import {
  GrantsGovOpportunityGateway,
  LibsqlOpportunityRepository,
  systemClock,
  uuidIdGenerator,
} from '@merit/infrastructure';
import { wire } from '../composition.js';

/**
 * The scheduled daily sweep: federal ingestion, screening, and thresholded alerts.
 */
export const dailySweep = async (): Promise<void> => {
  const { config, db, logger, organizations, gmail, notifications } = await wire();

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
  if (!sweep.ok) {
    logger.error('daily sweep failed', { reason: sweep.error.message });
    process.exitCode = 1;
    return;
  }

  const allOrganizations = await organizations.listAll();
  if (!allOrganizations.ok) {
    logger.error('daily sweep failed while loading organizations', {
      reason: allOrganizations.error.message,
    });
    process.exitCode = 1;
    return;
  }

  for (const organization of allOrganizations.value) {
    const alerts = await new SendHighFitAlerts(
      new LibsqlOpportunityRepository(db),
      notifications,
      gmail,
    ).execute({
      organization,
      recipients: config.SCHEDULED_ALERT_RECIPIENTS,
      boardLimit: 100,
    });
    if (!alerts.ok) {
      logger.error('daily sweep failed while sending alerts', {
        organizationId: organization.id,
        reason: alerts.error.message,
      });
      process.exitCode = 1;
      return;
    }
  }

  logger.info('daily sweep complete', {
    organizations: allOrganizations.value.length,
    searches: sweep.value.searchesRun,
    hits: sweep.value.hitsSeen,
    alerts: 'thresholded',
  });
};
