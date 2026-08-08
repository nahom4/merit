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
    },
  },
  metadata: { databaseUrl: DATABASE_URL },
});

export { DATABASE_URL as E2E_DATABASE_URL };
