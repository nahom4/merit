import { err, ok, type Result } from '@merit/shared';
import type { FunderFinancialYear } from '@merit/domain';
import type { FunderFinancialsGateway } from '../ports/funder-financials.port.js';
import { FinancialsUnavailable } from '../errors.js';

/**
 * A hand-written stand-in for ProPublica. Both of its states matter to the use case: the
 * report must be right when the trend is there, and must still be produced when it is not.
 */
export class StubFunderFinancialsGateway implements FunderFinancialsGateway {
  private constructor(
    private readonly years: readonly FunderFinancialYear[],
    private readonly unavailable: boolean,
  ) {}

  static returning(years: readonly FunderFinancialYear[]): StubFunderFinancialsGateway {
    return new StubFunderFinancialsGateway(years, false);
  }

  static failing(): StubFunderFinancialsGateway {
    return new StubFunderFinancialsGateway([], true);
  }

  async fetchFinancials(ein: string): Promise<Result<readonly FunderFinancialYear[], FinancialsUnavailable>> {
    if (this.unavailable) {
      return err(new FinancialsUnavailable('ProPublica did not respond', { ein, source: 'propublica' }));
    }
    return ok(this.years);
  }
}
