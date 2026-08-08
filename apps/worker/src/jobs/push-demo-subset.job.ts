import { consoleLogger } from '@merit/shared';
import { createDatabase, loadConfig, migrate, type Database } from '@merit/infrastructure';

/**
 * Copies the demo subset of the local corpus to a remote libSQL database.
 *
 * The full graph is 1.1GB -- two million entities and a million grant records -- which is neither
 * necessary nor affordable on a hosted free tier. What the deployed screens actually read is a
 * closure anchored on one cached prospect listing:
 *
 *   - every small table, in full
 *   - `funders`, in full: 61k narrow rows
 *   - `grant_records` for the funders on that listing -- every one of them per funder, never a
 *     per-funder cap. Openness and affinity are computed from grantee history, so a truncated
 *     history is not a smaller answer, it is a wrong one presented as a right one.
 *   - `entity_links` for those records and the `entities` they point at
 *   - B-group linked entities, because the reachability report recomputes peers on each request
 *
 * Idempotent: each table is cleared before it is filled.
 */

/** Turso is a network round trip per statement, so rows go up in batches or not at all. */
const PAGE = 5_000;
const BATCH = 500;

const SMALL_TABLES = [
  'organizations',
  'users',
  'user_sessions',
  'gmail_connections',
  'opportunities',
  'opportunity_programs',
  'drafts',
  'assessments',
  'outreach_threads',
  'scheduled_milestones',
  'scheduled_notifications',
  'sweep_runs',
  'model_calls',
  'model_response_cache',
  'eval_runs',
  'ingest_checkpoints',
  'prospect_listings',
  'funders',
] as const;

const copyTable = async (local: Database, remote: Database, table: string, where = ''): Promise<void> => {
  const total = Number((await local.execute(`SELECT count(*) AS c FROM "${table}" ${where}`)).rows[0]!['c']);
  if (total === 0) {
    consoleLogger.info('table empty, skipped', { table });
    return;
  }

  const { columns } = await local.execute(`SELECT * FROM "${table}" LIMIT 1`);
  const placeholders = `(${columns.map(() => '?').join(',')})`;
  const insert = `INSERT OR REPLACE INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES `;

  await remote.execute(`DELETE FROM "${table}"`);

  let copied = 0;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = await local.execute(`SELECT * FROM "${table}" ${where} LIMIT ${PAGE} OFFSET ${offset}`);
    for (let i = 0; i < page.rows.length; i += BATCH) {
      const slice = page.rows.slice(i, i + BATCH);
      await remote.execute({
        sql: insert + slice.map(() => placeholders).join(','),
        args: slice.flatMap((row) => columns.map((c) => row[c] as never)),
      });
      copied += slice.length;
    }
    consoleLogger.info('copied', { table, copied, total });
  }
};

export const pushDemoSubset = async (args: readonly string[]): Promise<void> => {
  const [remoteUrl] = args;
  const remoteToken = process.env['REMOTE_DATABASE_AUTH_TOKEN'];
  if (remoteUrl === undefined || remoteToken === undefined) {
    consoleLogger.error('push-demo-subset needs a target', {
      usage: 'worker push-demo-subset <libsql://...> with REMOTE_DATABASE_AUTH_TOKEN set',
    });
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const local = createDatabase({ url: config.DATABASE_URL, authToken: config.DATABASE_AUTH_TOKEN });
  const remote = createDatabase({ url: remoteUrl, authToken: remoteToken });

  const applied = await migrate(remote);
  consoleLogger.info('remote migrated', { applied: applied.length });

  // The funders on the cached listing decide the whole closure.
  const listings = await local.execute('SELECT payload FROM prospect_listings');
  const funderEins = [
    ...new Set(
      listings.rows.flatMap((row) =>
        (JSON.parse(String(row['payload'])) as { prospects: readonly { funderEin: string }[] }).prospects.map(
          (p) => p.funderEin,
        ),
      ),
    ),
  ];
  if (funderEins.length === 0) {
    consoleLogger.error('no cached prospect listing, so there is no closure to copy', {});
    process.exitCode = 1;
    return;
  }
  consoleLogger.info('closure anchored on prospect funders', { funders: funderEins.length });

  const inList = funderEins.map((ein) => `'${ein}'`).join(',');
  const grantsWhere = `WHERE funder_ein IN (${inList})`;
  const linksWhere = `WHERE grant_record_id IN (SELECT id FROM grant_records ${grantsWhere})`;
  const entitiesWhere = `WHERE (substr(ntee_code,1,1) = 'B' AND revenue_cents IS NOT NULL)
       OR ein IN (SELECT entity_ein FROM entity_links ${linksWhere} AND entity_ein IS NOT NULL)`;

  // Small tables first: the app is usable the moment they land, even while the graph is still going.
  for (const table of SMALL_TABLES) await copyTable(local, remote, table);

  await copyTable(local, remote, 'entities', entitiesWhere);
  await copyTable(local, remote, 'grant_records', grantsWhere);
  await copyTable(local, remote, 'entity_links', linksWhere);

  consoleLogger.info('push complete', {});
};
