import { consoleLogger } from '@merit/shared';
import { loadConfig } from '../config.js';
import { createDatabase } from './database.js';
import { migrate } from './migrator.js';

const config = loadConfig();
const db = createDatabase({ url: config.DATABASE_URL, authToken: config.DATABASE_AUTH_TOKEN });

const applied = await migrate(db);
consoleLogger.info(
  applied.length === 0 ? 'schema already up to date' : `applied ${applied.length} migration(s)`,
  { database: config.DATABASE_URL, migrations: applied.join(', ') },
);
db.close();
