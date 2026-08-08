import { z } from 'zod';
import { err, ok, unwrapOrThrow, type Result } from '@merit/shared';
import { Organization, type Ein, type OrganizationId } from '@merit/domain';
import { RepositoryUnavailable, type OrganizationRepository } from '@merit/application';
import type { Database } from './database.js';

/**
 * A database row is external input like any other: parsed at the edge, never trusted because
 * we wrote it. A column that stops matching this schema is a migration bug, and it should
 * surface here rather than as `undefined` three layers up.
 */
const OrganizationRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  ein: z.string(),
  city: z.string(),
  state: z.string(),
  ntee_code: z.string(),
  annual_revenue_cents: z.union([z.number(), z.bigint()]).transform(Number),
});

const toDomain = (row: unknown): Organization => {
  const parsed = OrganizationRowSchema.parse(row);
  // Reaching here with an unparseable domain value means the write path let bad data in,
  // which is a bug, not a runtime condition -- so this throws rather than returning a Result.
  return unwrapOrThrow(
    Organization.parse({
      id: parsed.id,
      name: parsed.name,
      ein: parsed.ein,
      city: parsed.city,
      state: parsed.state,
      nteeCode: parsed.ntee_code,
      annualRevenueDollars: parsed.annual_revenue_cents / 100,
    }),
  );
};

export class LibsqlOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Database) {}

  async save(organization: Organization): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO organizations (id, name, ein, city, state, ntee_code, annual_revenue_cents)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                ein = excluded.ein,
                city = excluded.city,
                state = excluded.state,
                ntee_code = excluded.ntee_code,
                annual_revenue_cents = excluded.annual_revenue_cents`,
        args: [
          organization.id as string,
          organization.name,
          organization.ein as string,
          organization.city,
          organization.state as string,
          organization.nteeCode as string,
          organization.annualRevenue as number,
        ],
      });
      return ok(undefined);
    } catch (cause) {
      return err(repositoryUnavailable('save', cause));
    }
  }

  async findById(id: OrganizationId): Promise<Result<Organization | null, RepositoryUnavailable>> {
    return this.findOne('SELECT * FROM organizations WHERE id = ?', [id as string], 'findById');
  }

  async findByEin(ein: Ein): Promise<Result<Organization | null, RepositoryUnavailable>> {
    return this.findOne('SELECT * FROM organizations WHERE ein = ?', [ein as string], 'findByEin');
  }

  async listAll(): Promise<Result<readonly Organization[], RepositoryUnavailable>> {
    try {
      const result = await this.db.execute('SELECT * FROM organizations ORDER BY name');
      return ok(result.rows.map(toDomain));
    } catch (cause) {
      return err(repositoryUnavailable('listAll', cause));
    }
  }

  private async findOne(
    sql: string,
    args: readonly string[],
    operation: string,
  ): Promise<Result<Organization | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({ sql, args: [...args] });
      const row = result.rows[0];
      return ok(row === undefined ? null : toDomain(row));
    } catch (cause) {
      return err(repositoryUnavailable(operation, cause));
    }
  }
}

const repositoryUnavailable = (operation: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table: 'organizations',
  });
