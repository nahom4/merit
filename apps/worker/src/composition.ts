import { consoleLogger } from '@merit/shared';
import { createDatabase, loadConfig, LibsqlGrantRepository, migrate } from '@merit/infrastructure';

/** The worker's composition root. Adapters are constructed here and nowhere else. */
export const wire = async () => {
  const config = loadConfig();
  const db = createDatabase({ url: config.DATABASE_URL, authToken: config.DATABASE_AUTH_TOKEN });
  await migrate(db);
  return { config, db, logger: consoleLogger, grants: new LibsqlGrantRepository(db) };
};
