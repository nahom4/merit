import { err, ok, type Result } from '@merit/shared';
import type { FilerFormType, FunderFinancialYear } from '@merit/domain';
import { FinancialsUnavailable } from '@merit/application';
import type { FunderFinancialsGateway } from '@merit/application';
import { ProPublicaOrganizationSchema } from './organization.schema.js';

export interface ProPublicaGatewayOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Retries after the first attempt. Zero in tests that are asserting a single call. */
  readonly retries?: number;
}

/**
 * The formtype codes the API returns, verified against live responses: the Duke Endowment
 * (990-PF) files as 2, the Museum of Modern Art (990) as 0.
 */
const FORM_TYPES: Readonly<Record<number, FilerFormType>> = {
  0: 'form_990',
  1: 'form_990_ez',
  2: 'form_990_pf',
};

/** ProPublica states money in whole dollars. Merit is integer cents everywhere. */
const toCents = (dollars: number | null): number | null =>
  dollars === null ? null : Math.round(dollars * 100);

/**
 * A funder's summary financials from ProPublica's Nonprofit Explorer.
 *
 * Free, keyless, and outside our control, so every failure mode is a value: a timeout, a
 * non-200, and a payload that no longer matches the schema all come back as
 * `FinancialsUnavailable` and the report renders without a trend.
 */
export class ProPublicaFinancialsGateway implements FunderFinancialsGateway {
  constructor(private readonly options: ProPublicaGatewayOptions) {}

  async fetchFinancials(ein: string): Promise<Result<readonly FunderFinancialYear[], FinancialsUnavailable>> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/organizations/${ein}.json`;
    const attempts = (this.options.retries ?? 2) + 1;

    let lastFailure = new FinancialsUnavailable('no attempt was made', { ein, source: 'propublica' });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await this.attempt(url, ein);
      if (response.ok) return response;
      lastFailure = response.error;

      // A schema mismatch is not transient: the payload is the shape it is, and asking again
      // gets the same bytes. Only network-level failures are worth a second attempt.
      if (response.error.context['retryable'] !== true) return response;

      if (attempt < attempts) await backoff(attempt);
    }

    return err(lastFailure);
  }

  private async attempt(
    url: string,
    ein: string,
  ): Promise<Result<readonly FunderFinancialYear[], FinancialsUnavailable>> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: abort.signal,
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        // A 404 is a fact about this EIN, not a transient failure -- ProPublica simply has
        // no record of it, and retrying will not produce one.
        return err(
          new FinancialsUnavailable(`ProPublica returned ${response.status}`, {
            ein,
            source: 'propublica',
            status: response.status,
            retryable: response.status >= 500,
          }),
        );
      }

      const parsed = ProPublicaOrganizationSchema.safeParse(await response.json());
      if (!parsed.success) {
        return err(
          new FinancialsUnavailable('ProPublica payload did not match the expected schema', {
            ein,
            source: 'propublica',
            issue: parsed.error.issues[0]?.message ?? 'unknown',
            retryable: false,
          }),
        );
      }

      const years: FunderFinancialYear[] = [];
      for (const filing of parsed.data.filings_with_data) {
        const formType = FORM_TYPES[filing.formtype];
        if (formType === undefined) {
          // An unrecognised return type means we do not know what its fields mean. Skipping
          // the year would quietly understate the funder's giving, which is the failure mode
          // this project refuses; the whole fetch fails loudly instead and the report says so.
          return err(
            new FinancialsUnavailable('ProPublica returned an unrecognised form type', {
              ein,
              source: 'propublica',
              formType: filing.formtype,
              taxYear: filing.tax_prd_yr,
              retryable: false,
            }),
          );
        }

        years.push({
          taxYear: filing.tax_prd_yr,
          formType,
          totalRevenueCents: toCents(filing.totrevenue),
          totalExpensesCents: toCents(filing.totfuncexpns),
          totalAssetsEndCents: toCents(filing.totassetsend),
          // Only 990-PF carries grants paid in this summary. A 990 filer reports them on
          // Schedule I, so null here means "not on this return", never "gave nothing".
          grantsPaidCents: formType === 'form_990_pf' ? toCents(filing.contrpdpbks) : null,
        });
      }

      return ok(years);
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      return err(
        new FinancialsUnavailable(
          aborted ? 'ProPublica did not respond in time' : 'ProPublica could not be reached',
          {
            ein,
            source: 'propublica',
            cause: cause instanceof Error ? cause.message : String(cause),
            retryable: true,
          },
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Exponential backoff with jitter. Randomness lives in an adapter, which is where the rule
 * puts it -- and tests that assert call counts set `retries: 0` rather than waiting on it.
 */
const backoff = (attempt: number): Promise<void> => {
  const base = 100 * 2 ** (attempt - 1);
  return new Promise((resolve) => setTimeout(resolve, base + Math.random() * base));
};
