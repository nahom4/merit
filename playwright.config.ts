import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 3100;
const E2E_DATA_DIR = resolve('./data/e2e');
mkdirSync(E2E_DATA_DIR, { recursive: true });

/**
 * One database file per run, named for the run.
 *
 * Playwright starts the web server before global setup, so deleting and recreating a fixed
 * path pulls the file out from under a process that already has it open -- the server keeps
 * writing to the unlinked inode and rows survive across runs that were supposed to be clean.
 */
const DATABASE_URL = `file:${resolve(E2E_DATA_DIR, `e2e-${Date.now()}.db`)}`;

/**
 * ProPublica, served locally from a recorded real payload.
 *
 * The E2E tier does not mock, and this is not a mock: it is a real HTTP server returning
 * bytes the live API actually returned (`tests/fixtures/propublica/`, kept honest by the
 * nightly contract test). Pointing the app at the live service instead would make the suite
 * fail whenever ProPublica has a bad afternoon, which tests nothing about Merit. The port is
 * fixed here because Playwright starts the web server before global setup runs.
 */
const PROPUBLICA_PORT = 3199;
const PROPUBLICA_BASE_URL = `http://127.0.0.1:${PROPUBLICA_PORT}`;

/**
 * Grants.gov and Gemini, served locally for the same reason and on the same terms.
 *
 * The Grants.gov payloads are real recorded responses (`tests/fixtures/grants-gov/`, kept
 * honest by the nightly contract test). The Gemini server speaks the documented envelope --
 * Merit is designed to run with no model credential at all, so the E2E suite must not need
 * one, and `tests/contract/gemini.contract.test.ts` is what keeps that envelope true.
 */
const GRANTS_GOV_PORT = 3197;
const GEMINI_PORT = 3198;

/**
 * E2E runs against the real app and a real database, seeded by the global setup from the
 * fixture IRS bundle. No mocks at this tier -- the point is to prove the slice is wired
 * together through every layer.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env['CI'] === undefined ? 0 : 1,
  workers: 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @merit/web dev',
    url: `http://127.0.0.1:${PORT}/organizations/new`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL,
      MERIT_DATA_DIR: E2E_DATA_DIR,
      MERIT_E2E_DATABASE_URL: DATABASE_URL,
      PROPUBLICA_BASE_URL,
      GRANTS_GOV_BASE_URL: `http://127.0.0.1:${GRANTS_GOV_PORT}`,
      // Attachments are a different host in production (api.grants.gov answers 403 for them),
      // so they are a different path on the same fixture server here. The bytes served are the
      // real recorded announcement PDF, and `pdftotext` really runs on them.
      GRANTS_GOV_ATTACHMENT_BASE_URL: `http://127.0.0.1:${GRANTS_GOV_PORT}/att/download`,
      GEMINI_BASE_URL: `http://127.0.0.1:${GEMINI_PORT}`,
      GEMINI_API_KEY: 'e2e-fixture-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
      /**
       * The rate limit is raised for E2E, and only for E2E.
       *
       * 15 a minute is the free tier's real ceiling and the number the app runs with. It exists
       * to protect a quota that does not exist here: these calls go to a fixture server on
       * localhost. Leaving it at 15 makes the suite spend minutes asleep inside the token
       * bucket — S3 alone scores dozens of pairs before S4 asks for its first draft — and what
       * that would be testing is `setTimeout`.
       *
       * The bucket itself is not going untested. `token-bucket.test.ts` proves it meters, and
       * `orchestrator.test.ts` proves the queue drains in priority order under exhaustion, both
       * against an injected clock rather than by waiting.
       */
      GEMINI_REQUESTS_PER_MINUTE: '600',
    },
  },
  metadata: { databaseUrl: DATABASE_URL },
});

export {
  DATABASE_URL as E2E_DATABASE_URL,
  PROPUBLICA_PORT as E2E_PROPUBLICA_PORT,
  GRANTS_GOV_PORT as E2E_GRANTS_GOV_PORT,
  GEMINI_PORT as E2E_GEMINI_PORT,
};
