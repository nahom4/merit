import { existsSync } from 'node:fs';
import { createDatabase, type Database } from '@merit/infrastructure';
import thresholds from '../thresholds.json' with { type: 'json' };

export { thresholds };

/**
 * Evals run against the real corpus, never a fixture. They are the tier that measures the
 * claims this project makes, and a claim measured on invented data is not measured.
 *
 * The corpus is built by `pnpm worker ingest`, `pnpm worker load-bmf`, and
 * `pnpm worker resolve`. It is not committed -- it is 3GB of public data, reproducible in
 * about an hour on any machine.
 */
export const EVAL_DATABASE_URL = process.env['MERIT_EVAL_DATABASE_URL'] ?? 'file:./data/merit.db';

export const corpusIsPresent = (): boolean => {
  const path = EVAL_DATABASE_URL.replace(/^file:/, '');
  return existsSync(path);
};

export const openCorpus = (): Database => {
  if (!corpusIsPresent()) {
    throw new Error(
      `No corpus at ${EVAL_DATABASE_URL}. Build it with:\n` +
        '  pnpm worker ingest && pnpm worker load-bmf && pnpm worker resolve\n' +
        'or point MERIT_EVAL_DATABASE_URL at an existing one.',
    );
  }
  return createDatabase({ url: EVAL_DATABASE_URL });
};

/**
 * Hands control back to the event loop's poll phase.
 *
 * Awaiting a local libSQL query resolves without ever leaving the microtask queue, so an
 * eval loop that only awaits queries runs as one uninterrupted macrotask however long it
 * takes. Past sixty seconds the test runner's own IPC call times out and the run fails with
 * every assertion passing. `setImmediate` is the yield that actually lets a message through.
 */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/** Records a measurement so a regression is visible against the commit that caused it. */
export const recordEvalRun = async (
  db: Database,
  metric: string,
  value: number,
  dataset: string,
): Promise<void> => {
  await db.execute({
    sql: 'INSERT INTO eval_runs (id, metric, value, dataset, commit_sha, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      `${metric}-${Date.now()}`,
      metric,
      value,
      dataset,
      process.env['GITHUB_SHA'] ?? null,
      new Date().toISOString(),
    ],
  });
};
