import { SendWeeklyBriefing } from '@merit/application';
import { LibsqlOpportunityRepository, systemClock } from '@merit/infrastructure';
import { wire } from '../composition.js';

export const weeklyBriefing = async (): Promise<void> => {
  const { db, logger, organizations, gmail, notifications, config } = await wire();
  const allOrganizations = await organizations.listAll();
  if (!allOrganizations.ok) {
    logger.error('weekly briefing failed while loading organizations', { reason: allOrganizations.error.message });
    process.exitCode = 1;
    return;
  }

  for (const organization of allOrganizations.value) {
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
    if (!result.ok) {
      logger.error('weekly briefing failed', { organizationId: organization.id, reason: result.error.message });
      process.exitCode = 1;
      return;
    }
  }

  logger.info('weekly briefing complete', { organizations: allOrganizations.value.length });
};
