import { err, NotFoundError, ok, type Result } from '@merit/shared';
import type { Organization, OrganizationId } from '@merit/domain';
import type { OrganizationRepository } from '../../ports/organization-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';

export interface GetOrganizationInput {
  readonly organizationId: string;
}

export type GetOrganizationError = NotFoundError | RepositoryUnavailable;

export class GetOrganization {
  constructor(private readonly organizations: OrganizationRepository) {}

  async execute({
    organizationId,
  }: GetOrganizationInput): Promise<Result<Organization, GetOrganizationError>> {
    const found = await this.organizations.findById(organizationId as OrganizationId);
    if (!found.ok) return found;
    if (found.value === null) {
      return err(new NotFoundError('organization not found', { organizationId }));
    }
    return ok(found.value);
  }
}
