import { err, ok, type Result } from '@merit/shared';
import type { DraftRepository, StoredDraft } from '../ports/draft-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

/**
 * A hand-written fake, not a mock. It keeps the one property the SQL has and a unit test
 * depends on: a draft belongs to one (organisation, target) pair, and saving twice replaces
 * rather than accumulating.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private readonly drafts = new Map<string, StoredDraft>();
  private failsOnce = false;

  failNextQuery(): void {
    this.failsOnce = true;
  }

  private guard<T>(operation: string): Result<T, RepositoryUnavailable> | null {
    if (!this.failsOnce) return null;
    this.failsOnce = false;
    return err(new RepositoryUnavailable('draft query failed', { operation, table: 'drafts' }));
  }

  async saveDraft(draft: StoredDraft): Promise<Result<void, RepositoryUnavailable>> {
    const failure = this.guard<void>('saveDraft');
    if (failure !== null) return failure;

    this.drafts.set(`${draft.organizationId}:${draft.targetId}`, draft);
    return ok(undefined);
  }

  async findDraft(
    organizationId: string,
    targetId: string,
  ): Promise<Result<StoredDraft | null, RepositoryUnavailable>> {
    const failure = this.guard<StoredDraft | null>('findDraft');
    if (failure !== null) return failure;

    return ok(this.drafts.get(`${organizationId}:${targetId}`) ?? null);
  }
}
