import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './database.js';
import { splitStatements } from './split-statements.js';

const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Migrations are forward-only, numbered, and committed. No auto-sync from code, because a
 * schema that drifts from its migration history cannot be rebuilt on a fresh machine.
 */
export const migrationFiles = (): readonly string[] =>
  readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .sort();

/**
 * Applies every migration not yet recorded, each inside its own transaction so a failure
 * halfway through leaves the database on the last complete version rather than in between.
 */
export const migrate = async (db: Database): Promise<readonly string[]> => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (await db.execute('SELECT name FROM schema_migrations')).rows.map((row) => String(row['name'])),
  );

  const newlyApplied: string[] = [];
  for (const name of migrationFiles()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIRECTORY, name), 'utf8');
    const transaction = await db.transaction('write');
    try {
      for (const statement of splitStatements(sql)) {
        await transaction.execute(statement);
      }
      await transaction.execute({
        sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
        args: [name, new Date().toISOString()],
      });
      await transaction.commit();
      newlyApplied.push(name);
    } catch (cause) {
      await transaction.rollback();
      throw new Error(`migration ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
        cause,
      });
    }
  }
  return newlyApplied;
};
