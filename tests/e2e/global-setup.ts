import { createServer, type Server } from 'node:http';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SweepFederalOpportunities } from '@merit/application';
import {
  createDatabase,
  GrantsGovOpportunityGateway,
  LibsqlOpportunityRepository,
  migrate,
  systemClock,
  uuidIdGenerator,
} from '@merit/infrastructure';
import { seedGivingGraph } from '../support/seed-graph.js';
import {
  startGrantsGovFixtureServer,
  stopServer,
  SWEEP_KEYWORDS,
} from '../support/grants-gov-fixture-server.js';
import { geminiEnvelope, startGeminiFixtureServer } from '../support/gemini-fixture-server.js';
import {
  E2E_DATABASE_URL,
  E2E_GEMINI_PORT,
  E2E_GRANTS_GOV_PORT,
  E2E_PROPUBLICA_PORT,
} from '../../playwright.config.js';

/**
 * A real database, built from the committed migrations and seeded with a real giving graph:
 * the fixture IRS bundle ingested through the real use cases. Everything the prospect screen
 * renders came out of an actual filing.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const directory = resolve('./data/e2e');

  // Databases from previous runs, not this one -- the running dev server already holds this
  // run's file open, and unlinking it would leave the server writing to a dead inode.
  const thisRun = E2E_DATABASE_URL.replace(/^file:/, '');
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (path !== thisRun) rmSync(path, { force: true, recursive: true });
  }

  const db = createDatabase({ url: E2E_DATABASE_URL });
  await migrate(db);
  const seeded = await seedGivingGraph(db);

  const grantsGov = await startGrantsGovFixtureServer(E2E_GRANTS_GOV_PORT);
  const gemini = await startGeminiFixtureServer(E2E_GEMINI_PORT, { replies: [FIT_SCORE_REPLY] });

  // The federal board is a board of what the sweep found, so the sweep runs here -- through
  // the real gateway, the real use case, and the real repository, over payloads the live
  // Grants.gov API returned.
  const swept = await new SweepFederalOpportunities(
    new GrantsGovOpportunityGateway({
      baseUrl: `http://127.0.0.1:${E2E_GRANTS_GOV_PORT}`,
      timeoutMs: 10_000,
      retries: 0,
    }),
    new LibsqlOpportunityRepository(db),
    systemClock,
    uuidIdGenerator('sweep'),
  ).execute({ keywords: SWEEP_KEYWORDS, perKeyword: 10 });
  if (!swept.ok) throw new Error(`e2e federal sweep failed: ${swept.error.message}`);

  db.close();

  console.log(`e2e graph seeded: ${seeded.grants} grants, ${seeded.entities} registry entities`);
  console.log(
    `e2e federal sweep: ${swept.value.opportunitiesInserted} opportunities, ` +
      `${swept.value.parseFaults} parse faults`,
  );

  const propublica = await startProPublicaFixtureServer();
  return async () => {
    await new Promise<void>((closed) => propublica.close(() => closed()));
    await stopServer(grantsGov);
    await stopServer(gemini.server);
  };
}

/**
 * One canned fit score for every announcement on the board.
 *
 * "Education" is in the program-area menu for every pair the S3 spec exercises, because the
 * profile it creates is an education organisation -- so this answer survives the real parse
 * boundary rather than being waved through.
 */
const FIT_SCORE_REPLY = geminiEnvelope(
  JSON.stringify({
    fitScore: 68,
    rationale:
      'The announcement funds services close to what this organisation already delivers, at a ' +
      'scale it could absorb.',
    matchedProgramAreas: ['Education'],
    gaps: ['No evaluation partner is named in the profile.'],
  }),
);

/**
 * A real HTTP server on a real socket, returning a payload the live ProPublica API actually
 * returned. The E2E tier does not mock; it also must not fail because a third party is having
 * a bad afternoon, and those two facts are reconciled by recording real bytes rather than
 * inventing them. The nightly contract test regenerates this fixture from the live API.
 *
 * Every EIN gets the same body: the report only ever asks about one funder at a time, and
 * which foundation's finances the fixture describes is not what these tests are checking.
 */
const startProPublicaFixtureServer = async (): Promise<Server> => {
  const payload = readFileSync(resolve('tests/fixtures/propublica/duke-endowment-560529965.json'), 'utf8');

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(payload);
  });

  await new Promise<void>((ready) => server.listen(E2E_PROPUBLICA_PORT, '127.0.0.1', ready));
  console.log(`e2e propublica fixture server on :${E2E_PROPUBLICA_PORT}`);
  return server;
};
