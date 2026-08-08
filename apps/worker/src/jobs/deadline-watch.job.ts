import { SendDeadlineWarnings } from '@merit/application';
import { systemClock } from '@merit/infrastructure';
import { wire } from '../composition.js';

export const deadlineWatch = async (): Promise<void> => {
  const { logger, organizations, gmail, notifications, milestones, config } = await wire();
  const allOrganizations = await organizations.listAll();
  if (!allOrganizations.ok) {
    logger.error('deadline watch failed while loading organizations', {
      reason: allOrganizations.error.message,
    });
    process.exitCode = 1;
    return;
  }

  for (const organization of allOrganizations.value) {
    const result = await new SendDeadlineWarnings(milestones, notifications, gmail, systemClock).execute({
      organizationId: organization.id as string,
      recipients: config.SCHEDULED_ALERT_RECIPIENTS,
      horizonDays: 7,
    });
    if (!result.ok) {
      logger.error('deadline watch failed', {
        organizationId: organization.id,
        reason: result.error.message,
      });
      process.exitCode = 1;
      return;
    }
  }

  logger.info('deadline watch complete', { organizations: allOrganizations.value.length });
};
