import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { consoleLogger } from '@merit/shared';
import { loadConfig } from '../config.js';
import { createDatabase } from './database.js';
import { migrate } from './migrator.js';

const parseEnvFile = (contents: string): Record<string, string> => {
  const env: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match === null) continue;

    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined) continue;
    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    env[key] = quoted ? rawValue.slice(1, -1) : rawValue;
  }

  return env;
};

const loadEnvFile = (path: string): boolean => {
  if (!existsSync(path)) return false;

  const parsed = parseEnvFile(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
};

const findWorkspaceRoot = (start: string): string => {
  let current = start;
  for (let parent = dirname(current); parent !== current; parent = dirname(current)) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    current = parent;
  }
  return start;
};

const loadWorkspaceEnv = (): void => {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  loadEnvFile(join(workspaceRoot, '.env.local'));

  // The web app is the main place people edit config in this repo, so let it override the
  // workspace default when it exists. Shell exports still win because we only fill blanks.
  loadEnvFile(join(workspaceRoot, 'apps/web/.env.local'));
};

loadWorkspaceEnv();

const config = loadConfig();
const db = createDatabase({ url: config.DATABASE_URL, authToken: config.DATABASE_AUTH_TOKEN });

const applied = await migrate(db);
consoleLogger.info(
  applied.length === 0 ? 'schema already up to date' : `applied ${applied.length} migration(s)`,
  { database: config.DATABASE_URL, migrations: applied.join(', ') },
);
db.close();
