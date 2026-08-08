import { DomainError } from '@merit/shared';

/**
 * The database is unreachable, or a statement failed for a reason the caller cannot fix.
 * Expected at runtime -- a use case returns it rather than letting a driver exception escape.
 */
export class RepositoryUnavailable extends DomainError {
  readonly code = 'repository_unavailable';
}

/** An organisation with this EIN is already on file. Creating a second one would split its history. */
export class DuplicateOrganization extends DomainError {
  readonly code = 'duplicate_organization';
}
