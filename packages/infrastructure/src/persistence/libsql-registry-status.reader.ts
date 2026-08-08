import { err, ok, type Result } from '@merit/shared';
import { RepositoryUnavailable } from '@merit/application';
import type { RegistryStatus, RegistryStatusReader } from '@merit/application';
import type { Database } from './database.js';

/**
 * What the IRS Business Master File says about one organisation's exempt status.
 *
 * Three answers, kept distinct: a row with subsection 3, a row without a subsection, and no row
 * at all. Screening treats the last two as undecided rather than as "not a charity" -- the
 * registry is a snapshot, and an EIN missing from it is an absence of evidence.
 */
export class LibsqlRegistryStatusReader implements RegistryStatusReader {
  constructor(private readonly db: Database) {}

  async findStatus(ein: string): Promise<Result<RegistryStatus, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT ein, subsection FROM entities WHERE ein = ?',
        args: [ein],
      });

      const row = result.rows[0];
      if (row === undefined) return ok({ ein, isInRegistry: false, subsectionCode: null });

      return ok({
        ein,
        isInRegistry: true,
        subsectionCode: row['subsection'] === null ? null : Number(row['subsection']),
      });
    } catch (cause) {
      return err(
        new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'findStatus',
          table: 'entities',
        }),
      );
    }
  }
}
