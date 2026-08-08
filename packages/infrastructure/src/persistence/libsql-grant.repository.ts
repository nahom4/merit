import { createHash } from 'node:crypto';
import { err, ok, type Result } from '@merit/shared';
import { GrantRecord, normalizeName } from '@merit/domain';
import { RepositoryUnavailable, type GrantRepository, type IngestCheckpoint } from '@merit/application';
import type { Database } from './database.js';

/** A stable id for a grant. Content-addressed, so re-ingest rewrites rather than duplicates. */
export const grantId = (record: GrantRecord): string =>
  createHash('sha256').update(GrantRecord.identity(record)).digest('hex').slice(0, 32);

/** libSQL takes one statement per call, so batches go in as one transaction of many inserts. */
const BATCH_SIZE = 500;

export class LibsqlGrantRepository implements GrantRepository {
  constructor(private readonly db: Database) {}

  async upsertGrants(grants: readonly GrantRecord[]): Promise<Result<number, RepositoryUnavailable>> {
    if (grants.length === 0) return ok(0);
    try {
      for (let start = 0; start < grants.length; start += BATCH_SIZE) {
        const batch = grants.slice(start, start + BATCH_SIZE);
        const transaction = await this.db.transaction('write');
        try {
          for (const grant of batch) {
            await transaction.execute({
              sql: `INSERT INTO grant_records (
                      id, irs_object_id, funder_ein, tax_year, recipient_name, recipient_normalized,
                      recipient_city, recipient_state, recipient_zip, purpose, amount_cents,
                      source_form, stated_recipient_ein)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (id) DO UPDATE SET
                      recipient_normalized = excluded.recipient_normalized,
                      recipient_city = excluded.recipient_city,
                      recipient_state = excluded.recipient_state,
                      recipient_zip = excluded.recipient_zip,
                      stated_recipient_ein = excluded.stated_recipient_ein`,
              args: [
                grantId(grant),
                grant.irsObjectId,
                grant.funderEin as string,
                grant.taxYear as number,
                grant.recipientName,
                normalizeName(grant.recipientName),
                grant.recipientCity,
                grant.recipientState as string | null,
                grant.recipientZip,
                grant.purpose,
                grant.amount as number,
                grant.sourceForm,
                grant.statedRecipientEin as string | null,
              ],
            });
          }

          // One row per funder per batch, not one per grant. A foundation with 400 grants
          // in a bundle was previously upserted 400 times, doubling the statements written
          // for a row whose contents do not change between them.
          for (const funder of distinctFunders(batch)) {
            await transaction.execute({
              sql: `INSERT INTO funders (ein, name, state, source_forms, first_tax_year, last_tax_year)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT (ein) DO UPDATE SET
                      name = excluded.name,
                      state = COALESCE(excluded.state, funders.state),
                      source_forms = CASE
                        WHEN instr(funders.source_forms, excluded.source_forms) > 0 THEN funders.source_forms
                        ELSE funders.source_forms || ',' || excluded.source_forms END,
                      first_tax_year = MIN(funders.first_tax_year, excluded.first_tax_year),
                      last_tax_year = MAX(funders.last_tax_year, excluded.last_tax_year)`,
              args: [
                funder.ein,
                funder.name,
                funder.state,
                funder.sourceForm,
                funder.firstTaxYear,
                funder.lastTaxYear,
              ],
            });
          }

          await transaction.commit();
        } catch (cause) {
          await transaction.rollback();
          throw cause;
        }
      }
      return ok(grants.length);
    } catch (cause) {
      return err(unavailable('upsertGrants', cause));
    }
  }

  async saveCheckpoint(checkpoint: IngestCheckpoint): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO ingest_checkpoints (
                bundle, status, filings_seen, grants_written, parse_faults, individuals_cents,
                reconciled_filings, reconciliation_faults, last_irs_object_id, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (bundle) DO UPDATE SET
                status = excluded.status,
                filings_seen = excluded.filings_seen,
                grants_written = excluded.grants_written,
                parse_faults = excluded.parse_faults,
                individuals_cents = excluded.individuals_cents,
                reconciled_filings = excluded.reconciled_filings,
                reconciliation_faults = excluded.reconciliation_faults,
                last_irs_object_id = excluded.last_irs_object_id,
                updated_at = excluded.updated_at`,
        args: [
          checkpoint.bundle,
          checkpoint.status,
          checkpoint.filingsSeen,
          checkpoint.grantsWritten,
          checkpoint.parseFaults,
          checkpoint.individualsCents,
          checkpoint.reconciledFilings,
          checkpoint.reconciliationFaults,
          checkpoint.lastIrsObjectId,
          new Date().toISOString(),
        ],
      });
      return ok(undefined);
    } catch (cause) {
      return err(unavailable('saveCheckpoint', cause));
    }
  }

  async findCheckpoint(bundle: string): Promise<Result<IngestCheckpoint | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM ingest_checkpoints WHERE bundle = ?',
        args: [bundle],
      });
      const row = result.rows[0];
      if (row === undefined) return ok(null);
      return ok({
        bundle: String(row['bundle']),
        status: String(row['status']) as IngestCheckpoint['status'],
        filingsSeen: Number(row['filings_seen']),
        grantsWritten: Number(row['grants_written']),
        parseFaults: Number(row['parse_faults']),
        individualsCents: Number(row['individuals_cents']),
        reconciledFilings: Number(row['reconciled_filings']),
        reconciliationFaults: Number(row['reconciliation_faults']),
        lastIrsObjectId: row['last_irs_object_id'] === null ? null : String(row['last_irs_object_id']),
      });
    } catch (cause) {
      return err(unavailable('findCheckpoint', cause));
    }
  }

  async countGrants(): Promise<Result<number, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute('SELECT COUNT(*) AS n FROM grant_records');
      return ok(Number(result.rows[0]?.['n'] ?? 0));
    } catch (cause) {
      return err(unavailable('countGrants', cause));
    }
  }
}

interface FunderRow {
  ein: string;
  name: string;
  state: string | null;
  sourceForm: string;
  firstTaxYear: number;
  lastTaxYear: number;
}

/** Collapses a batch of grants to the funders they came from, one row each. */
const distinctFunders = (grants: readonly GrantRecord[]): readonly FunderRow[] => {
  const funders = new Map<string, FunderRow>();
  for (const grant of grants) {
    const ein = grant.funderEin as string;
    const year = grant.taxYear as number;
    const existing = funders.get(ein);
    if (existing === undefined) {
      funders.set(ein, {
        ein,
        name: grant.funderName,
        state: grant.funderState as string | null,
        sourceForm: grant.sourceForm,
        firstTaxYear: year,
        lastTaxYear: year,
      });
      continue;
    }
    existing.firstTaxYear = Math.min(existing.firstTaxYear, year);
    existing.lastTaxYear = Math.max(existing.lastTaxYear, year);
    existing.state ??= grant.funderState as string | null;
  }
  return [...funders.values()];
};

const unavailable = (operation: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table: 'grant_records',
  });
