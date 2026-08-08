import { GrantRecord } from '@merit/domain';
import { text, toCents, toDollars } from './xml-text.js';
import type { ExtractionContext, ExtractionResult, RawFiling } from './extracted-filing.js';

interface RecipientRow {
  readonly RecipientBusinessName?: { readonly BusinessNameLine1Txt?: unknown };
  readonly USAddress?: {
    readonly CityNm?: unknown;
    readonly StateAbbreviationCd?: unknown;
    readonly ZIPCd?: unknown;
  };
  readonly ForeignAddress?: { readonly CityNm?: unknown; readonly CountryCd?: unknown };
  readonly RecipientEIN?: unknown;
  readonly CashGrantAmt?: unknown;
  readonly NonCashAssistanceAmt?: unknown;
  readonly PurposeOfGrantTxt?: unknown;
}

interface IndividualRow {
  readonly GrantTypeTxt?: unknown;
  readonly RecipientCnt?: unknown;
  readonly CashGrantAmt?: unknown;
}

interface ScheduleI {
  /** Part II: grants to organisations. These are the graph edges. */
  readonly RecipientTable?: readonly RecipientRow[];
  /** Part III: grants to individuals, reported in aggregate with no named recipient. */
  readonly GrantsOtherAsstToIndivInUSGrp?: readonly IndividualRow[];
}

/**
 * Form 990 Schedule I -- both tables.
 *
 * Parsing only 990-PF is the obvious path and misses this entirely, which in a single sample
 * bundle was 875 grant-making organisations and 7,777 grant records (Merit.md section 7).
 * Those are largely community foundations and federated funders: the most approachable
 * funders a small nonprofit has.
 *
 * Part II rows usually state the recipient's EIN. That is what makes the entity-resolution
 * evaluation possible -- withhold the EIN, run the pipeline on name and address alone, and
 * compare against the withheld truth.
 */
export const extractScheduleIGrants = (filing: RawFiling, context: ExtractionContext): ExtractionResult => {
  const schedule = filing.ReturnData?.['IRS990ScheduleI'] as ScheduleI | undefined;
  const rows = schedule?.RecipientTable ?? [];

  const grants = [];
  let parseFaults = 0;

  for (const [rowIndex, row] of rows.entries()) {
    // Non-cash assistance is part of what the grantee received; omitting it understates
    // in-kind funders such as food banks and equipment grantmakers.
    const cash = toDollars(row.CashGrantAmt);
    const nonCash = toDollars(row.NonCashAssistanceAmt);
    const amountDollars = (Number.isFinite(cash) ? cash : 0) + (Number.isFinite(nonCash) ? nonCash : 0);

    const parsed = GrantRecord.parse({
      irsObjectId: context.irsObjectId,
      funderEin: context.filerEin,
      funderName: context.filerName,
      funderState: context.filerState,
      taxYear: context.taxYear,
      recipientName: text(row.RecipientBusinessName?.BusinessNameLine1Txt),
      recipientCity: text(row.USAddress?.CityNm) ?? text(row.ForeignAddress?.CityNm),
      recipientState: text(row.USAddress?.StateAbbreviationCd),
      recipientZip: text(row.USAddress?.ZIPCd),
      purpose: text(row.PurposeOfGrantTxt),
      amountDollars: Number.isFinite(cash) || Number.isFinite(nonCash) ? amountDollars : Number.NaN,
      sourceForm: '990-SI',
      statedRecipientEin: text(row.RecipientEIN),
      rowIndex,
    });

    if (parsed.ok) grants.push(parsed.value);
    else parseFaults += 1;
  }

  const grantsToIndividualsCents = (schedule?.GrantsOtherAsstToIndivInUSGrp ?? []).reduce(
    (total, row) => total + (toCents(row.CashGrantAmt) ?? 0),
    0,
  );

  return {
    grants,
    parseFaults,
    // Schedule I has no single stated total comparable to the 990-PF summary field, so
    // reconciliation for these filings is reported as unavailable rather than as zero.
    statedTotalCents: null,
    grantsToIndividualsCents,
  };
};
