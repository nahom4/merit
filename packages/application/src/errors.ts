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

/** No funder with this EIN is in the giving graph. Expected: a URL can name anything. */
export class FunderNotFound extends DomainError {
  readonly code = 'funder_not_found';
}

/**
 * A third-party financial source could not be read -- timeout, outage, or a payload that did
 * not match its schema. Expected, and never fatal: the reachability report is built from IRS
 * filings and states that the trend is missing rather than failing the page.
 */
export class FinancialsUnavailable extends DomainError {
  readonly code = 'financials_unavailable';
}

/**
 * The federal opportunity feed could not be read -- timeout, non-200, or a payload that no
 * longer matches its schema. Expected: a sweep is a scheduled job against someone else's
 * service, and it reports what it could not read rather than pretending it read nothing.
 */
export class OpportunitySourceUnavailable extends DomainError {
  readonly code = 'opportunity_source_unavailable';
}

/**
 * No model call could be made: the daily quota is spent, or the API could not be reached.
 *
 * Expected, and never fatal. On exhaustion, persisted results are served and new work is
 * queued -- the system gets slower rather than failing (Merit.md section 9).
 */
export class ModelUnavailable extends DomainError {
  readonly code = 'model_unavailable';
}

/**
 * The model answered, twice, with something that does not satisfy the schema it was asked for.
 *
 * Returned rather than coerced. Accepting partial output, defaulting a missing field, or
 * storing the raw text "for later" are all silent fallbacks, and bad data in the database is
 * worse than a call that failed.
 */
export class ModelOutputInvalid extends DomainError {
  readonly code = 'model_output_invalid';
}
