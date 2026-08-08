import type { Result } from '@merit/shared';
import type { Ein, Organization, OrganizationId } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

/**
 * Persistence for the organisation Merit works on behalf of.
 *
 * The port returns domain types, never rows. Row-to-domain mapping is the adapter's job,
 * and a row that will not map is a parse fault the adapter reports -- not a half-built
 * object handed upward.
 */
export interface OrganizationRepository {
  save(organization: Organization): Promise<Result<void, RepositoryUnavailable>>;
  findById(id: OrganizationId): Promise<Result<Organization | null, RepositoryUnavailable>>;
  findByEin(ein: Ein): Promise<Result<Organization | null, RepositoryUnavailable>>;
}
