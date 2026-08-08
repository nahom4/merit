import { err, ok, type Result } from '@merit/shared';
import type {
  GmailConnectionRecord,
  GmailConnectionRepository,
} from '../ports/gmail-connection-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

export class InMemoryGmailConnectionRepository implements GmailConnectionRepository {
  private connection: GmailConnectionRecord | null = null;
  private failsOnce = false;

  failNextQuery(): void {
    this.failsOnce = true;
  }

  private guard<T>(operation: string): Result<T, RepositoryUnavailable> | null {
    if (!this.failsOnce) return null;
    this.failsOnce = false;
    return err(
      new RepositoryUnavailable('gmail connection query failed', { operation, table: 'gmail_connections' }),
    );
  }

  async getConnection(
    _accountId: string,
  ): Promise<Result<GmailConnectionRecord | null, RepositoryUnavailable>> {
    const failure = this.guard<GmailConnectionRecord | null>('getConnection');
    if (failure !== null) return failure;
    return ok(this.connection);
  }

  async saveConnection(record: GmailConnectionRecord): Promise<Result<void, RepositoryUnavailable>> {
    const failure = this.guard<void>('saveConnection');
    if (failure !== null) return failure;
    this.connection = record;
    return ok(undefined);
  }
}
