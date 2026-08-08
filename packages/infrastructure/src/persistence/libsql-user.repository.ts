import { z } from 'zod';
import type { Database } from './database.js';

const UserRowSchema = z.object({
  email: z.string(),
  name: z.string(),
  organization_id: z.string().nullable(),
});

export interface MeritUser {
  readonly email: string;
  readonly name: string;
  readonly organizationId: string | null;
}

const toUser = (row: unknown): MeritUser => {
  const parsed = UserRowSchema.parse(row);
  return { email: parsed.email, name: parsed.name, organizationId: parsed.organization_id };
};

/**
 * Sign-in and the one association it exists for: user -> organisation profile.
 *
 * No port and no use case: there is no domain rule here, only storage.
 */
export class LibsqlUserRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: { email: string; name: string; now: string }): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO users (email, name, organization_id, created_at)
            VALUES (?, ?, NULL, ?)
            ON CONFLICT (email) DO UPDATE SET name = excluded.name`,
      args: [input.email, input.name, input.now],
    });
  }

  async createSession(input: { id: string; email: string; now: string }): Promise<void> {
    await this.db.execute({
      sql: 'INSERT INTO user_sessions (id, email, created_at) VALUES (?, ?, ?)',
      args: [input.id, input.email, input.now],
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM user_sessions WHERE id = ?', args: [id] });
  }

  async findBySession(sessionId: string): Promise<MeritUser | null> {
    const result = await this.db.execute({
      sql: `SELECT u.email, u.name, u.organization_id
            FROM user_sessions s JOIN users u ON u.email = s.email
            WHERE s.id = ?`,
      args: [sessionId],
    });
    const row = result.rows[0];
    return row === undefined ? null : toUser(row);
  }

  async linkOrganization(input: { email: string; organizationId: string }): Promise<void> {
    await this.db.execute({
      sql: 'UPDATE users SET organization_id = ? WHERE email = ?',
      args: [input.organizationId, input.email],
    });
  }
}
