import type { Result } from '@merit/shared';
import type { FunderFinancialYear } from '@merit/domain';
import type { FinancialsUnavailable } from '../errors.js';

/**
 * A funder's summary financials, from outside the IRS bulk filings.
 *
 * This is the only third-party runtime dependency the reachability report has, and it is not
 * load-bearing: the report is built from filings and degrades to saying the trend is missing.
 * Callers treat a failure here as a value, never as a reason to fail the page.
 */
export interface FunderFinancialsGateway {
  fetchFinancials(ein: string): Promise<Result<readonly FunderFinancialYear[], FinancialsUnavailable>>;
}
