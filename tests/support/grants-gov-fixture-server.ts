import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES = resolve('tests/fixtures/grants-gov');

/**
 * The three search terms whose live responses are recorded. A term with no recording returns an
 * empty hit list, which is what Grants.gov itself does for a term nothing matches.
 */
export const RECORDED_SEARCHES: Readonly<Record<string, string>> = {
  literacy: 'search2-adult-literacy.json',
  'animal food safety': 'search2-animal-food-safety.json',
  'Delta States Rural': 'search2-delta-rural-health.json',
};

export const SWEEP_KEYWORDS = Object.keys(RECORDED_SEARCHES);

const EMPTY_SEARCH = JSON.stringify({
  errorcode: 0,
  msg: 'Webservice Succeeds',
  data: { hitCount: 0, startRecord: 0, oppHits: [] },
});

/**
 * A real HTTP server on a real socket, returning bytes the live Grants.gov API actually
 * returned. This is not a mock: the integration and E2E tiers do not mock, and they also must
 * not fail because a federal service is having a bad afternoon. Those two facts are reconciled
 * by recording real responses rather than inventing them, and the nightly contract test
 * regenerates these fixtures from the live API.
 */
export const startGrantsGovFixtureServer = async (port: number): Promise<Server> => {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const payload = (() => {
        try {
          return JSON.parse(body) as Record<string, unknown>;
        } catch {
          return {};
        }
      })();

      const path = (request.url ?? '').split('?')[0] ?? '';

      if (path.endsWith('/search2')) {
        const keyword = String(payload['keyword'] ?? '');
        const file = RECORDED_SEARCHES[keyword];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(file === undefined ? EMPTY_SEARCH : readFileSync(resolve(FIXTURES, file), 'utf8'));
        return;
      }

      if (path.endsWith('/fetchOpportunity')) {
        const id = String(payload['opportunityId'] ?? '');
        const file = resolve(FIXTURES, `fetch-opportunity-${id}.json`);
        if (!existsSync(file)) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ errorcode: 1, msg: 'no such opportunity' }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(readFileSync(file, 'utf8'));
        return;
      }

      response.writeHead(404);
      response.end();
    });
  });

  await new Promise<void>((ready) => server.listen(port, '127.0.0.1', ready));
  return server;
};

export const stopServer = (server: Server): Promise<void> =>
  new Promise((closed) => server.close(() => closed()));
