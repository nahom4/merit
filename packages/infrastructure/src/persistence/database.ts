import { createClient, type Client, type Config } from '@libsql/client';

/** The libSQL client, named for what it is so the rest of the code never imports the driver. */
export type Database = Client;

export interface DatabaseConfig {
  readonly url: string;
  readonly authToken?: string | undefined;
  /** How long a statement waits for a writer to finish before failing. */
  readonly busyTimeoutMs?: number;
}

/**
 * Merit has two runtimes over one database: an offline worker that writes for hours, and a
 * serving plane that reads while it does. On a local file that is exactly the shape SQLite
 * handles badly by default -- a reader gets `SQLITE_BUSY` the moment the worker holds a write
 * transaction, and the prospect screen fails while an ingest is running.
 *
 * WAL lets readers proceed against the last committed snapshot while a write is in flight,
 * and the busy timeout absorbs the brief exclusive locks WAL still takes at checkpoint.
 * Neither applies to a remote Turso URL, which has its own concurrency model.
 */
const isLocalFile = (url: string): boolean => url.startsWith('file:') || !url.includes('://');

export const createDatabase = ({ url, authToken, busyTimeoutMs = 10_000 }: DatabaseConfig): Database => {
  const config: Config = authToken === undefined ? { url } : { url, authToken };
  const client = createClient(config);

  if (isLocalFile(url)) {
    // Fire-and-forget: these are session pragmas, and any statement issued afterwards is
    // queued behind them by the driver.
    void client.execute('PRAGMA journal_mode = WAL');
    void client.execute(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    // Durability is still on; this only skips the fsync on every commit, which over 1.4M
    // inserted rows is the difference between an hour and a day.
    void client.execute('PRAGMA synchronous = NORMAL');
  }

  return client;
};
