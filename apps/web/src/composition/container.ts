import 'server-only';
import { CreateOrganization, GetOrganization, ScoreProspects } from '@merit/application';
import {
  createDatabase,
  loadConfig,
  LibsqlOrganizationRepository,
  LibsqlProspectRepository,
  uuidIdGenerator,
  type Database,
} from '@merit/infrastructure';

/**
 * The only place adapters are constructed. Everything above this file takes ports.
 *
 * Next.js re-evaluates modules across dev reloads, so the client is memoised on
 * globalThis rather than rebuilt per request -- a new connection per render exhausts
 * file handles under E2E.
 */
const globalForDb = globalThis as unknown as { meritDb?: Database };

const database = (): Database => {
  const config = loadConfig();
  globalForDb.meritDb ??= createDatabase({
    url: config.DATABASE_URL,
    authToken: config.DATABASE_AUTH_TOKEN,
  });
  return globalForDb.meritDb;
};

export const organizationRepository = () => new LibsqlOrganizationRepository(database());

export const createOrganization = () =>
  new CreateOrganization(organizationRepository(), uuidIdGenerator('org'));

export const getOrganization = () => new GetOrganization(organizationRepository());

export const scoreProspects = () => new ScoreProspects(new LibsqlProspectRepository(database()));
