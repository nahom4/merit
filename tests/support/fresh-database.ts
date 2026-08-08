import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, migrate, type Database } from '@merit/infrastructure';

export interface FreshDatabase {
  readonly db: Database;
  readonly url: string;
  destroy(): Promise<void>;
}

/**
 * A real libSQL database, created from the committed migrations and thrown away afterwards.
 * Integration tests use real infrastructure -- no mocks, no in-memory substitute for SQL
 * (docs/decisions/0002). One database per test file keeps them independent under parallelism.
 */
export const freshDatabase = async (): Promise<FreshDatabase> => {
  const directory = mkdtempSync(join(tmpdir(), 'merit-test-'));
  const url = `file:${join(directory, 'merit.db')}`;
  const db = createDatabase({ url });
  await migrate(db);
  return {
    db,
    url,
    destroy: async () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
};
