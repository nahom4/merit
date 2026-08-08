import { err, ok, type Result } from '@merit/shared';
import type { LinkDecision } from '@merit/domain';
import { RepositoryUnavailable } from '@merit/application';
import type { EntityRepository, RegistryCandidate, UnresolvedGrant } from '@merit/application';
import type { RegistryEntity } from '../irs/bmf-loader.js';
import type { Database } from './database.js';

const BATCH_SIZE = 1_000;

export class LibsqlEntityRepository implements EntityRepository {
  constructor(private readonly db: Database) {}

  async upsertEntities(entities: readonly RegistryEntity[]): Promise<Result<number, RepositoryUnavailable>> {
    if (entities.length === 0) return ok(0);
    try {
      for (let start = 0; start < entities.length; start += BATCH_SIZE) {
        const transaction = await this.db.transaction('write');
        try {
          for (const entity of entities.slice(start, start + BATCH_SIZE)) {
            await transaction.execute({
              sql: `INSERT INTO entities (ein, canonical_name, normalized_name, ntee_code, city, state, zip,
                                          revenue_cents, blocking_key, subsection)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (ein) DO UPDATE SET
                      canonical_name = excluded.canonical_name,
                      normalized_name = excluded.normalized_name,
                      ntee_code = excluded.ntee_code,
                      city = excluded.city,
                      state = excluded.state,
                      zip = excluded.zip,
                      revenue_cents = excluded.revenue_cents,
                      blocking_key = excluded.blocking_key,
                      subsection = excluded.subsection`,
              args: [
                entity.ein,
                entity.canonicalName,
                entity.normalizedName,
                entity.nteeCode,
                entity.city,
                entity.state,
                entity.zip,
                entity.revenueCents,
                entity.blockingKey,
                entity.subsectionCode,
              ],
            });
          }
          await transaction.commit();
        } catch (cause) {
          await transaction.rollback();
          throw cause;
        }
      }
      return ok(entities.length);
    } catch (cause) {
      return err(unavailable('upsertEntities', cause));
    }
  }

  /** Every grant whose recipient has not been decided yet, in id order so a resumed run
   *  continues rather than restarting. */
  async *unresolvedGrants(batchSize: number): AsyncGenerator<readonly UnresolvedGrant[]> {
    let after = '';
    while (true) {
      const result = await this.db.execute({
        sql: `SELECT g.id, g.recipient_name, g.recipient_normalized, g.recipient_city,
                     g.recipient_state, g.recipient_zip, g.stated_recipient_ein
              FROM grant_records g
              LEFT JOIN entity_links l ON l.grant_record_id = g.id
              WHERE l.grant_record_id IS NULL AND g.id > ?
              ORDER BY g.id
              LIMIT ?`,
        args: [after, batchSize],
      });
      if (result.rows.length === 0) return;

      yield result.rows.map((row) => ({
        grantRecordId: String(row['id']),
        recipientName: String(row['recipient_name']),
        recipientNormalized: String(row['recipient_normalized']),
        recipientCity: row['recipient_city'] === null ? null : String(row['recipient_city']),
        recipientState: row['recipient_state'] === null ? null : String(row['recipient_state']),
        recipientZip: row['recipient_zip'] === null ? null : String(row['recipient_zip']),
        statedRecipientEin: row['stated_recipient_ein'] === null ? null : String(row['stated_recipient_ein']),
      }));

      after = String(result.rows[result.rows.length - 1]?.['id']);
    }
  }

  async findCandidates(key: string): Promise<Result<readonly RegistryCandidate[], RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: `SELECT ein, canonical_name, city, state, zip, ntee_code, revenue_cents
              FROM entities WHERE blocking_key = ? LIMIT 500`,
        args: [key],
      });
      return ok(
        result.rows.map((row) => ({
          ein: String(row['ein']),
          name: String(row['canonical_name']),
          city: row['city'] === null ? null : String(row['city']),
          state: row['state'] === null ? null : String(row['state']),
          zip: row['zip'] === null ? null : String(row['zip']),
        })),
      );
    } catch (cause) {
      return err(unavailable('findCandidates', cause));
    }
  }

  async saveLinks(
    links: readonly { grantRecordId: string; decision: LinkDecision }[],
  ): Promise<Result<number, RepositoryUnavailable>> {
    if (links.length === 0) return ok(0);
    try {
      for (let start = 0; start < links.length; start += BATCH_SIZE) {
        const transaction = await this.db.transaction('write');
        try {
          for (const { grantRecordId, decision } of links.slice(start, start + BATCH_SIZE)) {
            await transaction.execute({
              sql: `INSERT INTO entity_links (grant_record_id, entity_ein, score_total, score_token_set,
                                              score_string_distance, score_address, decision, rejection_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (grant_record_id) DO UPDATE SET
                      entity_ein = excluded.entity_ein,
                      score_total = excluded.score_total,
                      score_token_set = excluded.score_token_set,
                      score_string_distance = excluded.score_string_distance,
                      score_address = excluded.score_address,
                      decision = excluded.decision,
                      rejection_reason = excluded.rejection_reason`,
              args: [
                grantRecordId,
                decision.kind === 'rejected' ? null : decision.entityId,
                decision.score?.total ?? null,
                decision.score?.tokenSet ?? null,
                decision.score?.stringDistance ?? null,
                decision.score?.addressAgreement ?? null,
                decision.kind,
                decision.kind === 'rejected' ? decision.reason : null,
              ],
            });
          }
          await transaction.commit();
        } catch (cause) {
          await transaction.rollback();
          throw cause;
        }
      }
      return ok(links.length);
    } catch (cause) {
      return err(unavailable('saveLinks', cause));
    }
  }

  async clearMachineLinks(): Promise<Result<number, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute('DELETE FROM entity_links WHERE reviewed_at IS NULL');
      return ok(Number(result.rowsAffected));
    } catch (cause) {
      return err(unavailable('clearMachineLinks', cause));
    }
  }

  async countEntities(): Promise<Result<number, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute('SELECT COUNT(*) AS n FROM entities');
      return ok(Number(result.rows[0]?.['n'] ?? 0));
    } catch (cause) {
      return err(unavailable('countEntities', cause));
    }
  }
}

const unavailable = (operation: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table: 'entities',
  });
