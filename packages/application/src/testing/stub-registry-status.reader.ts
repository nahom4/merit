import { err, ok, type Result } from '@merit/shared';
import { RepositoryUnavailable } from '../errors.js';
import type { RegistryStatus, RegistryStatusReader } from '../ports/registry-status.port.js';

/** The IRS registry as a test wants to state it: this EIN, this subsection, or no row at all. */
export class StubRegistryStatusReader implements RegistryStatusReader {
  private failsOnce = false;

  constructor(private readonly subsectionByEin: Readonly<Record<string, number | null>> = {}) {}

  failNextQuery(): void {
    this.failsOnce = true;
  }

  async findStatus(ein: string): Promise<Result<RegistryStatus, RepositoryUnavailable>> {
    if (this.failsOnce) {
      this.failsOnce = false;
      return err(
        new RepositoryUnavailable('registry lookup failed', { operation: 'findStatus', table: 'entities' }),
      );
    }

    return ok(
      Object.hasOwn(this.subsectionByEin, ein)
        ? { ein, isInRegistry: true, subsectionCode: this.subsectionByEin[ein] ?? null }
        : { ein, isInRegistry: false, subsectionCode: null },
    );
  }
}
