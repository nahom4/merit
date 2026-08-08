import type { Result } from '@merit/shared';
import type { RepositoryUnavailable } from '../../errors.js';
import type { OutreachRecord, OutreachRepository } from '../../ports/outreach-repository.port.js';

export interface ListOutreachesInput {
  readonly organizationId: string;
}

export class ListOutreaches {
  constructor(private readonly outreaches: OutreachRepository) {}

  async execute(
    input: ListOutreachesInput,
  ): Promise<Result<readonly OutreachRecord[], RepositoryUnavailable>> {
    return this.outreaches.listOutreaches(input.organizationId);
  }
}
