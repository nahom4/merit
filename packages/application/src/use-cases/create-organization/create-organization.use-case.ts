import { err, ok, type ParseError, type Result } from '@merit/shared';
import { Organization } from '@merit/domain';
import type { OrganizationRepository } from '../../ports/organization-repository.port.js';
import type { IdGenerator } from '../../ports/id-generator.port.js';
import { DuplicateOrganization } from '../../errors.js';
import type { RepositoryUnavailable } from '../../errors.js';

export type CreateOrganizationError = ParseError | DuplicateOrganization | RepositoryUnavailable;

/**
 * Creates the profile Merit works on behalf of.
 *
 * The id is generated rather than supplied, so the caller cannot collide with an existing
 * record, and the EIN is checked first: two profiles for one EIN would split an
 * organisation's funder history across two prospect lists.
 */
export class CreateOrganization {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: unknown): Promise<Result<Organization, CreateOrganizationError>> {
    if (typeof input !== 'object' || input === null) {
      return Organization.parse(input) as Result<Organization, CreateOrganizationError>;
    }

    const parsed = Organization.parse({ ...input, id: this.ids.next() });
    if (!parsed.ok) return parsed;
    const organization = parsed.value;

    const existing = await this.organizations.findByEin(organization.ein);
    if (!existing.ok) return existing;
    if (existing.value !== null) {
      return err(
        new DuplicateOrganization('an organization with this EIN already exists', {
          ein: organization.ein as string,
          existingId: existing.value.id as string,
        }),
      );
    }

    const saved = await this.organizations.save(organization);
    if (!saved.ok) return saved;
    return ok(organization);
  }
}
