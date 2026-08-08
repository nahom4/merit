import { GrantRecord } from '@merit/domain';
import { text, toCents, toDollars } from './xml-text.js';
import type { ExtractionContext, ExtractionResult, RawFiling } from './extracted-filing.js';

interface PartXvRow {
  readonly RecipientBusinessName?: { readonly BusinessNameLine1Txt?: unknown };
  readonly RecipientPersonNm?: unknown;
  readonly RecipientUSAddress?: {
    readonly CityNm?: unknown;
    readonly StateAbbreviationCd?: unknown;
    readonly ZIPCd?: unknown;
  };
  readonly RecipientForeignAddress?: { readonly CityNm?: unknown; readonly CountryCd?: unknown };
  readonly GrantOrContributionPurposeTxt?: unknown;
  readonly Amt?: unknown;
}

interface SupplementaryInformation {
  readonly GrantOrContributionPdDurYrGrp?: readonly PartXvRow[];
  readonly TotalGrantOrContriPdDurYrAmt?: unknown;
}

/**
 * 990-PF Part XV, "Grants and Contributions Paid During the Year".
 *
 * Grants approved for future payment (`GrantOrContributionApprvFutureGrp`) are deliberately
 * not extracted: they are intentions, not transfers, and counting them would inflate every
 * funder's apparent activity.
 */
export const extractPartXvGrants = (filing: RawFiling, context: ExtractionContext): ExtractionResult => {
  const supplementary = filing.ReturnData?.['IRS990PF'] as
    { readonly SupplementaryInformationGrp?: SupplementaryInformation } | undefined;
  const table = supplementary?.SupplementaryInformationGrp;
  const rows = table?.GrantOrContributionPdDurYrGrp ?? [];

  const grants = [];
  let parseFaults = 0;
  let grantsToIndividualsCents = 0;

  for (const [rowIndex, row] of rows.entries()) {
    const businessName = text(row.RecipientBusinessName?.BusinessNameLine1Txt);
    const personName = text(row.RecipientPersonNm);

    if (businessName === null && personName !== null) {
      // A named individual is not an organisation, so it is not an edge in the giving graph.
      // The money still counts toward the filing's total.
      const amount = Number(text(row.Amt));
      if (Number.isFinite(amount)) grantsToIndividualsCents += Math.round(amount * 100);
      continue;
    }

    const parsed = GrantRecord.parse({
      irsObjectId: context.irsObjectId,
      funderEin: context.filerEin,
      funderName: context.filerName,
      funderState: context.filerState,
      taxYear: context.taxYear,
      recipientName: businessName,
      recipientCity: text(row.RecipientUSAddress?.CityNm) ?? text(row.RecipientForeignAddress?.CityNm),
      recipientState: text(row.RecipientUSAddress?.StateAbbreviationCd),
      recipientZip: text(row.RecipientUSAddress?.ZIPCd),
      purpose: text(row.GrantOrContributionPurposeTxt),
      amountDollars: toDollars(row.Amt),
      sourceForm: '990-PF',
      statedRecipientEin: null,
      rowIndex,
    });

    if (parsed.ok) grants.push(parsed.value);
    else parseFaults += 1;
  }

  return {
    grants,
    parseFaults,
    statedTotalCents: toCents(table?.TotalGrantOrContriPdDurYrAmt),
    grantsToIndividualsCents,
  };
};
