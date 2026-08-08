import { SweepFederalOpportunities } from '@merit/application';
import {
  GrantsGovOpportunityGateway,
  LibsqlOpportunityRepository,
  systemClock,
  uuidIdGenerator,
} from '@merit/infrastructure';
import { wire } from '../composition.js';

/**
 * The federal sweep: search Grants.gov, fetch the detail behind every hit, store what is new.
 *
 * Idempotent by construction, so the daily 06:00 job in S6 can run this without accumulating
 * duplicates, and a killed run can simply be run again.
 */
export const sweepFederal = async (): Promise<void> => {
  const { config, db, logger } = await wire();

  const result = await new SweepFederalOpportunities(
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

  if (!result.ok) {
    logger.error('federal sweep failed', { reason: result.error.message });
    process.exitCode = 1;
    return;
  }

  logger.info('federal sweep complete', {
    searches: result.value.searchesRun,
    hits: result.value.hitsSeen,
    inserted: result.value.opportunitiesInserted,
    updated: result.value.opportunitiesUpdated,
    parseFaults: result.value.parseFaults,
  });
};
