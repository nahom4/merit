import type { Result } from '@merit/shared';
import type { RepositoryUnavailable } from '../errors.js';

/**
 * What the IRS registry says about one organisation's exempt status.
 *
 * `subsectionCode` is the BMF's SUBSECTION column: 3 is 501(c)(3). Null means the registry
 * carries a row without one, which is different again from having no row at all -- both are
 * reported honestly rather than being flattened into "not a charity".
 */
export interface RegistryStatus {
  readonly ein: string;
  readonly isInRegistry: boolean;
  readonly subsectionCode: number | null;
}

export interface RegistryStatusReader {
  findStatus(ein: string): Promise<Result<RegistryStatus, RepositoryUnavailable>>;
}
