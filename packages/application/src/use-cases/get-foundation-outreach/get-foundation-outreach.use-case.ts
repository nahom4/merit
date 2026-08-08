import type { Result } from '@merit/shared';
import type { OutreachRecord, OutreachRepository } from '../../ports/outreach-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';

export interface GetFoundationOutreachInput {
  readonly organizationId: string;
  readonly targetId: string;
}

export class GetFoundationOutreach {
  constructor(private readonly outreaches: OutreachRepository) {}

  async execute(
    input: GetFoundationOutreachInput,
  ): Promise<Result<OutreachRecord | null, RepositoryUnavailable>> {
    return this.outreaches.findOutreach(input.organizationId, input.targetId, 'foundation');
  }
}
