import { ResolveRecipients } from '@merit/application';
import { LibsqlEntityRepository } from '@merit/infrastructure';
import { wire } from '../composition.js';

/**
 * `pnpm worker resolve` decides the recipients that have no decision yet.
 * `pnpm worker resolve --reset` re-decides the whole corpus, which is what a threshold
 * refit requires -- without it the run is a no-op. Human review survives either way.
 */
export const resolveRecipients = async (args: readonly string[] = []): Promise<void> => {
  const { db, logger } = await wire();
  const reset = args.includes('--reset');
  if (reset) logger.info('re-resolving the whole corpus under the current thresholds', {});

  const result = await new ResolveRecipients(new LibsqlEntityRepository(db), logger).execute({ reset });

  if (!result.ok) {
    logger.error('resolution failed', result.error.toJSON().context);
    process.exitCode = 1;
    return;
  }
  logger.info('resolution complete', { ...result.value });
};
