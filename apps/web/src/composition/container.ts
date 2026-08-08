import 'server-only';
import {
  CreateOrganization,
  GetOrganization,
  ReportFunderReachability,
  ReportRunLog,
  ScoreProspects,
  ScreenFederalOpportunities,
  type ModelGateway,
} from '@merit/application';
import {
  createDatabase,
  GeminiGateway,
  loadConfig,
  LibsqlFunderRepository,
  LibsqlModelCallLog,
  LibsqlModelResponseCache,
  LibsqlOpportunityRepository,
  LibsqlOrganizationRepository,
  LibsqlProspectRepository,
  LibsqlRegistryStatusReader,
  ModelOrchestrator,
  ProPublicaFinancialsGateway,
  systemClock,
  TokenBucket,
  UnavailableModelGateway,
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

/**
 * The model's budget is global, so the bucket and the orchestrator around it are too.
 *
 * Two callers each obeying 15 requests a minute is 30 a minute, which is over the limit
 * however carefully each one behaves. Memoised on globalThis for the same reason the database
 * client is: Next.js re-evaluates modules across dev reloads, and a bucket rebuilt per request
 * is a bucket that never limits anything.
 */
const globalForModel = globalThis as unknown as { meritModel?: ModelGateway };

const modelGateway = (): ModelGateway => {
  if (globalForModel.meritModel !== undefined) return globalForModel.meritModel;

  const config = loadConfig();
  const inner =
    config.GEMINI_API_KEY === undefined
      ? // Running without a key is a supported configuration, not an error: everything
        // already scored is still served, and new work is queued rather than failed.
        new UnavailableModelGateway('no model credential is configured')
      : new GeminiGateway({
          baseUrl: config.GEMINI_BASE_URL,
          apiKey: config.GEMINI_API_KEY,
          model: config.GEMINI_MODEL,
          timeoutMs: config.GEMINI_TIMEOUT_MS,
          clock: systemClock,
        });

  globalForModel.meritModel = new ModelOrchestrator(inner, {
    bucket: new TokenBucket({
      perMinute: config.GEMINI_REQUESTS_PER_MINUTE,
      perDay: config.GEMINI_REQUESTS_PER_DAY,
      clock: systemClock,
    }),
    cache: new LibsqlModelResponseCache(database(), systemClock),
    log: new LibsqlModelCallLog(database()),
    clock: systemClock,
    model: config.GEMINI_MODEL,
  });
  return globalForModel.meritModel;
};

export const screenFederalOpportunities = () =>
  new ScreenFederalOpportunities(
    new LibsqlOpportunityRepository(database()),
    new LibsqlRegistryStatusReader(database()),
    modelGateway(),
    systemClock,
  );

export const reportRunLog = () =>
  new ReportRunLog(
    new LibsqlOpportunityRepository(database()),
    new LibsqlModelCallLog(database()),
    systemClock,
  );

/**
 * ProPublica is the only third-party service the web app calls at request time, and the
 * reachability report renders without it. Its timeout is deliberately short for that reason:
 * a slow supplementary source must not hold a page built from local filings.
 */
export const reportFunderReachability = () => {
  const config = loadConfig();
  return new ReportFunderReachability(
    new LibsqlFunderRepository(database()),
    new LibsqlProspectRepository(database()),
    new ProPublicaFinancialsGateway({
      baseUrl: config.PROPUBLICA_BASE_URL,
      timeoutMs: config.PROPUBLICA_TIMEOUT_MS,
    }),
  );
};
