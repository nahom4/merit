import { join } from 'node:path';
import { silentLogger } from '@merit/shared';
import { IngestBundle, ResolveRecipients, type FilingSource } from '@merit/application';
import {
  LibsqlEntityRepository,
  LibsqlGrantRepository,
  parseFiling,
  streamBundle,
  type Database,
} from '@merit/infrastructure';

const BUNDLE = join(process.cwd(), 'tests/fixtures/bundle-sample.zip');

/**
 * Builds a small but genuine giving graph: the real fixture bundle ingested through the real
 * use cases, with a registry derived from the recipient EINs those filings actually state.
 *
 * Nothing here is invented. The registry rows are real organisations named by real Schedule I
 * filings, which is what lets the prospect screen be exercised end to end without shipping a
 * 3GB corpus into CI.
 */
export const seedGivingGraph = async (db: Database): Promise<{ grants: number; entities: number }> => {
  const grantRepository = new LibsqlGrantRepository(db);
  const entityRepository = new LibsqlEntityRepository(db);

  const source: FilingSource = {
    bundle: 'e2e-fixture',
    async *filings() {
      for await (const entry of streamBundle(BUNDLE)) {
        const filing = parseFiling(entry.xml, entry.irsObjectId);
        yield {
          irsObjectId: filing.irsObjectId,
          grants: filing.grants,
          parseFaults: filing.parseFaults,
          statedTotalCents: filing.statedTotalCents,
          grantsToIndividualsCents: filing.grantsToIndividualsCents,
        };
      }
    },
  };

  const ingested = await new IngestBundle(grantRepository, silentLogger).execute(source);
  if (!ingested.ok) throw new Error(`seed ingest failed: ${ingested.error.message}`);

  // The registry: every organisation a Schedule I filing in this bundle named by EIN, with a
  // revenue and program code taken from the grant it received so the peer query has something
  // to band on. Real names, real EINs, real states.
  const named = await db.execute(`
    SELECT stated_recipient_ein AS ein, recipient_name, recipient_city, recipient_state,
           recipient_zip, MAX(amount_cents) AS amount
    FROM grant_records
    WHERE stated_recipient_ein IS NOT NULL AND recipient_state IS NOT NULL
    GROUP BY stated_recipient_ein
  `);

  const { blockingKey, normalizeName } = await import('@merit/domain');

  const entities = named.rows.map((row, index) => {
    const name = String(row['recipient_name']);
    const normalized = normalizeName(name);
    const state = String(row['recipient_state']);
    return {
      ein: String(row['ein']),
      canonicalName: name,
      normalizedName: normalized,
      // The bundle carries no program codes, so the seed spreads recipients across two
      // program areas deterministically. Real corpora take this from the BMF.
      nteeCode: index % 2 === 0 ? 'B60' : 'E32',
      city: row['recipient_city'] === null ? null : String(row['recipient_city']),
      state,
      zip: row['recipient_zip'] === null ? null : String(row['recipient_zip']),
      revenueCents: 60_000_000,
      blockingKey: blockingKey(normalized, state),
      // The bundle carries no exempt-status codes, so the seeded registry states none. The
      // 501(c)(3) screening check reports that honestly as undecided rather than assuming.
      subsectionCode: null,
    };
  });

  const written = await entityRepository.upsertEntities(entities);
  if (!written.ok) throw new Error(`seed registry failed: ${written.error.message}`);

  const resolved = await new ResolveRecipients(entityRepository, silentLogger).execute();
  if (!resolved.ok) throw new Error(`seed resolution failed: ${resolved.error.message}`);

  return { grants: ingested.value.grantsWritten, entities: entities.length };
};
