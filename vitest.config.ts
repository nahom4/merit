import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const alias = {
  '@merit/shared': pkg('shared'),
  '@merit/domain': pkg('domain'),
  '@merit/application': pkg('application'),
  '@merit/infrastructure': pkg('infrastructure'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: [
            'packages/**/*.test.ts',
            'apps/**/*.test.ts',
            'apps/**/*.test.tsx',
            // The eval harness has pure logic of its own -- the threshold fitter decides
            // what the linker's operating point is, and a mistake there is invisible in a
            // number that looks plausible either way.
            'evals/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**', 'evals/**/*.eval.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.int.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Each integration test file creates its own real libSQL file; running
          // them in one process keeps temp-file cleanup deterministic.
          pool: 'forks',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'contract',
          include: ['tests/contract/**/*.contract.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'eval',
          include: ['evals/**/*.eval.test.ts'],
          environment: 'node',
          testTimeout: 600_000,
          hookTimeout: 600_000,
          // Evals score hundreds of thousands of rows in tight synchronous loops. Run in
          // parallel they starve each other of CPU until a worker misses the reporter's
          // heartbeat and the run fails with an RPC timeout while every test passes.
          // One fork, one file at a time.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
