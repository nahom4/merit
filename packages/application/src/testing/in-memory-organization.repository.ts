import { err, ok, type Result } from '@merit/shared';
import { Ein, type Organization, type OrganizationId } from '@merit/domain';
import type { OrganizationRepository } from '../ports/organization-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

/**
 * A hand-written fake, not a mock. Unit tests read better against this than against five
 * lines of `vi.mock`, and it is harder to get wrong (docs/testing.md).
 *
 * It lives in `src/` rather than a test folder so integration tests and the eval harness can
 * import it to build scenarios without a database.
 */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly organizations = new Map<string, Organization>();
  private saveFailsOnce = false;
  private readFailsOnce = false;

  constructor(seed: readonly Organization[] = []) {
    for (const organization of seed) this.organizations.set(organization.id as string, organization);
  }

  /** Makes the next write fail, so callers can prove they surface it as a value. */
  failNextSave(): void {
    this.saveFailsOnce = true;
  }

  failNextRead(): void {
    this.readFailsOnce = true;
  }

  async save(organization: Organization): Promise<Result<void, RepositoryUnavailable>> {
    if (this.saveFailsOnce) {
      this.saveFailsOnce = false;
      return err(new RepositoryUnavailable('write failed', { operation: 'save' }));
    }
    this.organizations.set(organization.id as string, organization);
    return ok(undefined);
  }

  async findById(id: OrganizationId): Promise<Result<Organization | null, RepositoryUnavailable>> {
    if (this.readFailsOnce) {
      this.readFailsOnce = false;
      return err(new RepositoryUnavailable('read failed', { operation: 'findById' }));
    }
    return ok(this.organizations.get(id as string) ?? null);
  }

  async findByEin(ein: Ein): Promise<Result<Organization | null, RepositoryUnavailable>> {
    if (this.readFailsOnce) {
      this.readFailsOnce = false;
      return err(new RepositoryUnavailable('read failed', { operation: 'findByEin' }));
    }
    const found = [...this.organizations.values()].find((organization) => Ein.equals(organization.ein, ein));
    return ok(found ?? null);
  }

  async listAll(): Promise<Result<readonly Organization[], RepositoryUnavailable>> {
    if (this.readFailsOnce) {
      this.readFailsOnce = false;
      return err(new RepositoryUnavailable('read failed', { operation: 'listAll' }));
    }
    return ok([...this.organizations.values()]);
  }

  async count(): Promise<number> {
    return this.organizations.size;
  }
}
