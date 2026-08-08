import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDatabase, migrate } from '@merit/infrastructure';
import { seedGivingGraph } from '../support/seed-graph.js';
import { E2E_DATABASE_URL } from '../../playwright.config.js';

/**
 * A real database, built from the committed migrations and seeded with a real giving graph:
 * the fixture IRS bundle ingested through the real use cases. Everything the prospect screen
 * renders came out of an actual filing.
 */
export default async function globalSetup(): Promise<void> {
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
  db.close();

  console.log(`e2e graph seeded: ${seeded.grants} grants, ${seeded.entities} registry entities`);
}
